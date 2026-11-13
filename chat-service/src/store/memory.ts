import { randomUUID } from 'crypto';
import { BookingEvent, MatchEvent, matchRoomId, Message, Room, SYSTEM_SENDER } from '../types';
import { ChatStore, MatchApplyResult, newMessageId, systemText } from './types';

export class MemoryChatStore implements ChatStore {
  private readonly rooms = new Map<string, Room>();
  private readonly messages: Message[] = [];

  async init() {}
  async close() {}

  async applyBookingEvent(event: BookingEvent) {
    const { data } = event;
    const existing = this.rooms.get(data.bookingId);
    const base: Room = existing ?? {
      id: data.bookingId,
      kind: 'booking',
      status: 'open',
      memberIds: [data.playerId, data.ownerId],
      members: [],
      playerId: data.playerId,
      ownerId: data.ownerId,
      bookingId: null,
      version: null,
      venueName: data.venueName,
      courtName: data.courtName,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      createdAt: new Date().toISOString(),
    };
    const closedMatchRooms: Room[] = [];
    if (event.type === 'booking.cancelled') {
      this.rooms.set(data.bookingId, { ...base, status: 'closed' });
      // Sin reserva no hay partido: sus salas también se cierran.
      for (const room of this.rooms.values()) {
        if (room.kind === 'match' && room.bookingId === data.bookingId && room.status === 'open') {
          const closed = { ...room, status: 'closed' as const };
          this.rooms.set(room.id, closed);
          closedMatchRooms.push(closed);
        }
      }
    } else {
      this.rooms.set(data.bookingId, base);
    }
    return { closedMatchRooms };
  }

  async applyMatchEvent(event: MatchEvent): Promise<MatchApplyResult> {
    const d = event.data;
    const id = matchRoomId(d.matchId);
    const existing = this.rooms.get(id);
    if (existing && existing.version !== null && d.version <= existing.version) {
      return { applied: false, room: existing, addedIds: [], removedIds: [], closedNow: false, systemMessage: null };
    }
    // Una sala cerrada se queda cerrada; y si la reserva ya estaba cancelada, el partido nace cerrado.
    const bookingRoom = this.rooms.get(d.bookingId);
    const closed = existing?.status === 'closed' || d.status === 'cancelled' || bookingRoom?.status === 'closed';
    const room: Room = {
      id,
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
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.rooms.set(id, room);
    const before = new Set(existing?.memberIds ?? []);
    const after = new Set(room.memberIds);
    const text = systemText(event);
    const systemMessage = text ? await this.addMessage({ roomId: id, senderId: SYSTEM_SENDER, text, kind: 'system' }) : null;
    return {
      applied: true,
      room,
      addedIds: [...after].filter((x) => !before.has(x)),
      removedIds: [...before].filter((x) => !after.has(x)),
      closedNow: room.status === 'closed' && existing?.status !== 'closed',
      systemMessage,
    };
  }

  async getRoom(roomId: string) {
    return this.rooms.get(roomId) ?? null;
  }

  async listRoomsFor(userId: string) {
    return [...this.rooms.values()]
      .filter((r) => r.memberIds.includes(userId))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }

  async addMessage(input: { roomId: string; senderId: string; text: string; kind?: 'user' | 'system' }) {
    const { id, createdAt } = newMessageId(randomUUID());
    const message: Message = {
      id,
      roomId: input.roomId,
      senderId: input.senderId,
      kind: input.kind ?? 'user',
      text: input.text,
      createdAt: createdAt.toISOString(),
    };
    this.messages.push(message);
    return message;
  }

  async listMessages(roomId: string, options: { before?: string; limit: number }) {
    return this.messages
      .filter((m) => m.roomId === roomId && (options.before === undefined || m.id < options.before))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(-options.limit);
  }
}
