import http from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from './auth';
import { Logger } from './consumer';
import { RateLimiter } from './rate-limiter';
import { ChatStore, MatchApplyResult, MAX_MESSAGE_LENGTH } from './store/types';
import { AuthUser, BookingEvent, MatchEvent, Room } from './types';

export const HISTORY_ON_JOIN = 50;
const roomKey = (roomId: string) => `room:${roomId}`;
const userKey = (userId: string) => `user:${userId}`;

type Ack = (response: unknown) => void;
const reply = (ack: unknown, response: unknown) => {
  if (typeof ack === 'function') (ack as Ack)(response);
};
const fail = (ack: unknown, error: string) => reply(ack, { ok: false, error });

export const isParticipant = (room: Room, userId: string) => room.memberIds.includes(userId);

export function publicRoom(room: Room) {
  const { id, kind, status, playerId, ownerId, memberIds, members, venueName, courtName, startsAt, endsAt } = room;
  return { id, kind, status, playerId, ownerId, memberIds, members, venueName, courtName, startsAt, endsAt };
}

export interface ChatServerOptions {
  httpServer: http.Server;
  store: ChatStore;
  jwtSecret: string;
  corsOrigin: string | string[];
  log: Logger;
  /** Mensajes permitidos por socket en una ventana (por defecto 10 cada 10 s). */
  rateLimit?: { limit: number; windowMs: number };
}

/**
 * Servidor Socket.IO. Eventos del cliente (todos con confirmación `ack`):
 *   room:join {roomId}              -> { ok, room, messages, online }
 *   room:leave {roomId}
 *   message:send {roomId, text}     -> { ok, message }
 * Eventos del servidor: message:new, presence:update, room:opened, room:closed, room:left.
 * Solo los miembros de una sala entran a ella (jugador y dueño en una reserva; organizador y
 * jugadores en un partido); ni siquiera un admin.
 */
export function createChatServer(options: ChatServerOptions) {
  const { store, log } = options;
  const limit = options.rateLimit ?? { limit: 10, windowMs: 10_000 };
  const io = new Server(options.httpServer, { cors: { origin: options.corsOrigin } });

  // El mismo JWT que emite el monolito; sin llamadas síncronas a él.
  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token, options.jwtSecret);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  async function emitPresence(roomId: string) {
    const sockets = await io.in(roomKey(roomId)).fetchSockets();
    const online = [...new Set(sockets.map((s) => (s.data.user as AuthUser).id))];
    io.to(roomKey(roomId)).emit('presence:update', { roomId, online });
    return online;
  }

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthUser;
    const limiter = new RateLimiter(limit.limit, limit.windowMs);
    void socket.join(userKey(user.id)); // canal personal: avisos de salas nuevas o cerradas

    socket.on('room:join', async (roomId: unknown, ack: unknown) => {
      try {
        if (typeof roomId !== 'string' || !roomId || roomId.length > 100) return fail(ack, 'invalid_room');
        const room = await store.getRoom(roomId);
        if (!room) return fail(ack, 'room_not_found');
        if (!isParticipant(room, user.id)) return fail(ack, 'forbidden');
        await socket.join(roomKey(roomId));
        const [messages, online] = await Promise.all([
          store.listMessages(roomId, { limit: HISTORY_ON_JOIN }),
          emitPresence(roomId),
        ]);
        reply(ack, { ok: true, room: publicRoom(room), messages, online });
      } catch (error) {
        log.error(`room:join falló: ${(error as Error).message}`);
        fail(ack, 'internal');
      }
    });

    socket.on('room:leave', async (roomId: unknown, ack: unknown) => {
      if (typeof roomId !== 'string') return fail(ack, 'invalid_room');
      await socket.leave(roomKey(roomId));
      void emitPresence(roomId).catch((error) => log.warn(`presencia no emitida: ${(error as Error).message}`));
      reply(ack, { ok: true });
    });

    socket.on('message:send', async (payload: unknown, ack: unknown) => {
      try {
        const { roomId, text } = (payload ?? {}) as { roomId?: unknown; text?: unknown };
        if (typeof roomId !== 'string' || typeof text !== 'string') return fail(ack, 'invalid_message');
        const clean = text.trim();
        if (clean.length === 0 || clean.length > MAX_MESSAGE_LENGTH) return fail(ack, 'invalid_message');
        if (!socket.rooms.has(roomKey(roomId))) return fail(ack, 'not_joined');
        if (!limiter.allow()) return fail(ack, 'rate_limited');

        // Se vuelve a leer la sala en cada envío: si la reserva se canceló, ya no se puede escribir.
        const room = await store.getRoom(roomId);
        if (!room) return fail(ack, 'room_not_found');
        if (!isParticipant(room, user.id)) return fail(ack, 'forbidden');
        if (room.status !== 'open') return fail(ack, 'room_closed');

        const message = await store.addMessage({ roomId, senderId: user.id, text: clean });
        io.to(roomKey(roomId)).emit('message:new', message);
        reply(ack, { ok: true, message });
      } catch (error) {
        log.error(`message:send falló: ${(error as Error).message}`);
        fail(ack, 'internal');
      }
    });

    socket.on('disconnecting', () => {
      for (const key of socket.rooms) {
        if (key.startsWith('room:')) {
          // Cuando se ejecuta el callback el socket ya salió de la sala.
          setImmediate(() => void emitPresence(key.slice('room:'.length)).catch(() => undefined));
        }
      }
    });
  });

  /** La sala y el canal personal de cada miembro (los que no están dentro de la sala también se enteran). */
  const audience = (roomId: string, ids: string[]) => [roomKey(roomId), ...ids.map(userKey)];

  /** El consumidor llama a esto tras aplicar un evento de reserva: avisa a los clientes conectados. */
  function notifyBookingEvent(event: BookingEvent, closedMatchRooms: Room[] = []) {
    const { bookingId, playerId, ownerId, venueName, courtName, startsAt } = event.data;
    if (event.type === 'booking.cancelled') {
      io.to(roomKey(bookingId)).to(userKey(playerId)).to(userKey(ownerId)).emit('room:closed', { roomId: bookingId });
      // Sin reserva no hay partido: también se cierran sus salas.
      for (const room of closedMatchRooms) {
        io.to(audience(room.id, room.memberIds)).emit('room:closed', { roomId: room.id });
      }
    } else {
      io.to(userKey(playerId)).to(userKey(ownerId)).emit('room:opened', { roomId: bookingId, kind: 'booking', venueName, courtName, startsAt });
    }
  }

  /**
   * Tras aplicar un evento de partido: el aviso del sistema llega a la sala, los que entraron ven
   * aparecer la sala, y los que salieron dejan de recibir mensajes de inmediato (se les saca de la
   * sala, no solo se les impide escribir).
   */
  async function notifyMatchEvent(event: MatchEvent, result: MatchApplyResult) {
    if (!result.applied) return;
    const { room } = result;
    if (result.systemMessage) io.to(roomKey(room.id)).emit('message:new', result.systemMessage);
    for (const id of result.addedIds) {
      io.to(userKey(id)).emit('room:opened', { roomId: room.id, kind: 'match', venueName: room.venueName, courtName: room.courtName, startsAt: room.startsAt });
    }
    for (const id of result.removedIds) {
      io.in(userKey(id)).socketsLeave(roomKey(room.id));
      io.to(userKey(id)).emit('room:left', { roomId: room.id });
    }
    if (result.closedNow) {
      io.to(audience(room.id, room.memberIds)).emit('room:closed', { roomId: room.id });
    }
    await emitPresence(room.id);
  }

  return { io, notifyBookingEvent, notifyMatchEvent };
}
