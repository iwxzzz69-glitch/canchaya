import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { io as connectClient, Socket } from 'socket.io-client';
import { createChatServer, ChatServerOptions } from '../src/gateway';
import { MemoryChatStore } from '../src/store/memory';
import { ChatStore } from '../src/store/types';
import { BookingEvent, MatchEvent, Role } from '../src/types';

export const SECRET = 'secreto-de-pruebas-largo-1234567890';
export const silent = { info() {}, warn() {}, error() {} };

export const tokenFor = (id: string, role: Role = 'player', secret = SECRET) =>
  jwt.sign({ sub: id, email: `${id}@test.com`, role }, secret, { algorithm: 'HS256', expiresIn: '1h' });

export function bookingEvent(type: BookingEvent['type'], bookingId = 'b1', over: Partial<BookingEvent['data']> = {}, occurredAt = new Date().toISOString()): BookingEvent {
  return {
    eventId: `e-${Math.random().toString(36).slice(2)}`,
    type,
    occurredAt,
    version: 1,
    data: {
      bookingId,
      courtId: 'c1',
      courtName: 'Cancha 1',
      venueId: 'v1',
      venueName: 'Complejo Sol',
      playerId: 'p1',
      ownerId: 'o1',
      startsAt: '2026-11-20T20:00:00.000Z',
      endsAt: '2026-11-20T21:00:00.000Z',
      ...over,
    },
  };
}

export type Who = [id: string, name: string];

/** Evento de partido con el estado completo: el primer miembro es el organizador. */
export function matchEvent(
  type: MatchEvent['type'],
  matchId: string,
  version: number,
  members: Who[],
  over: { status?: 'open' | 'cancelled'; changed?: Who | null; bookingId?: string } = {},
): MatchEvent {
  return {
    eventId: `m-${Math.random().toString(36).slice(2)}`,
    type,
    occurredAt: new Date().toISOString(),
    version: 1,
    data: {
      matchId,
      bookingId: over.bookingId ?? `bk-${matchId}`,
      status: over.status ?? 'open',
      version,
      organizerId: members[0][0],
      members: members.map(([id, name]) => ({ id, name })),
      venueName: 'Complejo Sol',
      courtName: 'Cancha 1',
      startsAt: '2026-11-20T20:00:00.000Z',
      endsAt: '2026-11-20T21:00:00.000Z',
      changedPlayer: over.changed ? { id: over.changed[0], name: over.changed[1] } : null,
    },
  };
}

export interface TestServer {
  url: string;
  store: ChatStore;
  notify: ReturnType<typeof createChatServer>['notifyBookingEvent'];
  notifyMatch: ReturnType<typeof createChatServer>['notifyMatchEvent'];
  close(): Promise<void>;
}

export async function startServer(
  extra: Partial<Pick<ChatServerOptions, 'rateLimit'>> & { store?: ChatStore; configure?: (io: ReturnType<typeof createChatServer>['io']) => void } = {},
): Promise<TestServer> {
  const store = extra.store ?? new MemoryChatStore();
  const httpServer = http.createServer();
  const { io, notifyBookingEvent, notifyMatchEvent } = createChatServer({ httpServer, store, jwtSecret: SECRET, corsOrigin: '*', log: silent, rateLimit: extra.rateLimit });
  extra.configure?.(io);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  return {
    url,
    store,
    notify: notifyBookingEvent,
    notifyMatch: notifyMatchEvent,
    close: () => new Promise<void>((r) => void io.close(() => r())),
  };
}

export function connect(url: string, token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectClient(url, { auth: token ? { token } : {}, reconnection: false, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => {
      socket.close();
      reject(e);
    });
  });
}

export const ask = <T = any>(socket: Socket, event: string, payload: unknown): Promise<T> =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

export const nextEvent = <T = any>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando "${event}"`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

/** Comprueba que NO llega el evento en un lapso corto. */
export const noEvent = (socket: Socket, event: string, ms = 250) =>
  new Promise<boolean>((resolve) => {
    const handler = () => resolve(false);
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, ms);
  });
