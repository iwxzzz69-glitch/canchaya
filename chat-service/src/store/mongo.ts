import { randomUUID } from 'crypto';
import { Collection, Db, MongoClient } from 'mongodb';
import { BookingEvent, MatchEvent, matchRoomId, Message, Room, RoomMember, SYSTEM_SENDER } from '../types';
import { ChatStore, MatchApplyResult, newMessageId, systemText } from './types';

interface RoomDoc {
  _id: string;
  kind?: 'booking' | 'match'; // las salas anteriores a los partidos no lo tienen: son de reserva
  status: 'open' | 'closed';
  memberIds?: string[];
  members?: RoomMember[];
  playerId: string;
  ownerId: string | null;
  bookingId?: string | null;
  version?: number | null;
  venueName: string;
  courtName: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
}
interface MessageDoc {
  _id: string;
  roomId: string;
  senderId: string;
  kind?: 'user' | 'system';
  text: string;
  createdAt: Date;
}

const toRoom = (d: RoomDoc): Room => ({
  id: d._id,
  kind: d.kind ?? 'booking',
  status: d.status,
  memberIds: d.memberIds ?? [d.playerId, ...(d.ownerId ? [d.ownerId] : [])],
  members: d.members ?? [],
  playerId: d.playerId,
  ownerId: d.ownerId,
  bookingId: d.bookingId ?? null,
  version: d.version ?? null,
  venueName: d.venueName,
  courtName: d.courtName,
  startsAt: d.startsAt.toISOString(),
  endsAt: d.endsAt.toISOString(),
  createdAt: d.createdAt.toISOString(),
});
const toMessage = (d: MessageDoc): Message => ({
  id: d._id,
  roomId: d.roomId,
  senderId: d.senderId,
  kind: d.kind ?? 'user',
  text: d.text,
  createdAt: d.createdAt.toISOString(),
});

const DUPLICATE_KEY = 11000;
const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === DUPLICATE_KEY;
const MAX_ATTEMPTS = 6;

export class MongoChatStore implements ChatStore {
  private client: MongoClient;
  private db!: Db;
  private rooms!: Collection<RoomDoc>;
  private messages!: Collection<MessageDoc>;

  constructor(url: string) {
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  }

  async init() {
    await this.client.connect();
    this.db = this.client.db();
    this.rooms = this.db.collection<RoomDoc>('rooms');
    this.messages = this.db.collection<MessageDoc>('messages');
    await this.rooms.createIndex({ playerId: 1, startsAt: -1 });
    await this.rooms.createIndex({ ownerId: 1, startsAt: -1 });
    await this.rooms.createIndex({ memberIds: 1, startsAt: -1 });
    await this.rooms.createIndex({ bookingId: 1 }, { sparse: true });
    await this.messages.createIndex({ roomId: 1, _id: -1 });
  }

  async close() {
    await this.client.close();
  }

  async applyBookingEvent(event: BookingEvent) {
    const d = event.data;
    const details = {
      kind: 'booking' as const,
      memberIds: [d.playerId, d.ownerId],
      playerId: d.playerId,
      ownerId: d.ownerId,
      venueName: d.venueName,
      courtName: d.courtName,
      startsAt: new Date(d.startsAt),
      endsAt: new Date(d.endsAt),
      createdAt: new Date(),
    };
    // Un solo upsert atómico por evento: repetirlo o recibirlo en otro orden da el mismo resultado.
    // `status` nunca se escribe en confirmed si la sala ya existe, así una sala cerrada no se reabre.
    if (event.type === 'booking.confirmed') {
      await this.rooms.updateOne({ _id: d.bookingId }, { $setOnInsert: { ...details, status: 'open' } }, { upsert: true });
      return { closedMatchRooms: [] };
    }
    await this.rooms.updateOne({ _id: d.bookingId }, { $set: { status: 'closed' }, $setOnInsert: details }, { upsert: true });
    // Sin reserva no hay partido: se cierran sus salas (las que estaban abiertas, para avisar solo una vez).
    const open = await this.rooms.find({ kind: 'match', bookingId: d.bookingId, status: 'open' }).toArray();
    if (open.length) {
      await this.rooms.updateMany({ _id: { $in: open.map((r) => r._id) } }, { $set: { status: 'closed' } });
    }
    return { closedMatchRooms: open.map((r) => toRoom({ ...r, status: 'closed' })) };
  }

  async applyMatchEvent(event: MatchEvent): Promise<MatchApplyResult> {
    const d = event.data;
    const id = matchRoomId(d.matchId);

    // Concurrencia optimista: se lee, se calcula y se escribe SOLO si la sala sigue como se leyó
    // (misma versión y mismo estado). Si otro evento se coló en medio, se vuelve a intentar.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const existing = await this.rooms.findOne({ _id: id });
      if (existing && existing.version != null && d.version <= existing.version) {
        return { applied: false, room: toRoom(existing), addedIds: [], removedIds: [], closedNow: false, systemMessage: null };
      }
      const bookingRoom = await this.rooms.findOne({ _id: d.bookingId }, { projection: { status: 1 } });
      const closed = existing?.status === 'closed' || d.status === 'cancelled' || bookingRoom?.status === 'closed';
      const next: RoomDoc = {
        _id: id,
        kind: 'match',
        status: closed ? 'closed' : 'open',
        memberIds: d.members.map((m) => m.id),
        members: d.members,
        playerId: d.organizerId,
        ownerId: null,
        bookingId: d.bookingId,
        version: d.version,
        venueName: d.venueName,
        courtName: d.courtName,
        startsAt: new Date(d.startsAt),
        endsAt: new Date(d.endsAt),
        createdAt: existing?.createdAt ?? new Date(),
      };
      try {
        if (!existing) {
          await this.rooms.insertOne(next);
        } else {
          const { _id, ...fields } = next;
          const filter = existing.version == null
            ? { _id, version: { $exists: false } }
            : { _id, version: existing.version, status: existing.status };
          const written = await this.rooms.updateOne(filter as never, { $set: fields });
          if (written.matchedCount === 0) continue; // alguien cambió la sala entre la lectura y la escritura
        }
      } catch (error) {
        if (isDuplicateKey(error)) continue; // otro evento creó la sala justo ahora
        throw error;
      }

      const before = new Set(existing?.memberIds ?? []);
      const after = new Set(next.memberIds);
      const text = systemText(event);
      const systemMessage = text ? await this.addMessage({ roomId: id, senderId: SYSTEM_SENDER, text, kind: 'system' }) : null;
      return {
        applied: true,
        room: toRoom(next),
        addedIds: [...after].filter((x) => !before.has(x)),
        removedIds: [...before].filter((x) => !after.has(x)),
        closedNow: next.status === 'closed' && existing?.status !== 'closed',
        systemMessage,
      };
    }
    throw new Error(`No se pudo aplicar el evento de partido ${event.eventId}: demasiada contención`);
  }

  async getRoom(roomId: string) {
    const doc = await this.rooms.findOne({ _id: roomId });
    return doc ? toRoom(doc) : null;
  }

  async listRoomsFor(userId: string) {
    const docs = await this.rooms
      .find({ $or: [{ memberIds: userId }, { playerId: userId }, { ownerId: userId }] })
      .sort({ startsAt: -1 })
      .limit(200)
      .toArray();
    return docs.map(toRoom);
  }

  async addMessage(input: { roomId: string; senderId: string; text: string; kind?: 'user' | 'system' }) {
    const { id, createdAt } = newMessageId(randomUUID());
    const doc: MessageDoc = {
      _id: id,
      roomId: input.roomId,
      senderId: input.senderId,
      kind: input.kind ?? 'user',
      text: input.text,
      createdAt,
    };
    await this.messages.insertOne(doc);
    return toMessage(doc);
  }

  async listMessages(roomId: string, options: { before?: string; limit: number }) {
    const filter = options.before === undefined ? { roomId } : { roomId, _id: { $lt: options.before } };
    const docs = await this.messages.find(filter).sort({ _id: -1 }).limit(options.limit).toArray();
    return docs.reverse().map(toMessage);
  }
}
