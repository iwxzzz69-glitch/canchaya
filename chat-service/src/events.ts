import { BookingEvent, ChatEvent, MatchEvent, MatchEventType, RoomMember } from './types';

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventError';
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 300) throw new InvalidEventError(`Campo inválido: ${name}`);
  return v;
};
const date = (v: unknown, name: string): string => {
  const s = str(v, name);
  if (Number.isNaN(new Date(s).getTime())) throw new InvalidEventError(`Fecha inválida: ${name}`);
  return s;
};

/** Valida el contenido de un mensaje del bus. Lanza InvalidEventError si no cumple el contrato. */
export function parseBookingEvent(raw: Buffer | string): BookingEvent {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    throw new InvalidEventError('El mensaje no es JSON');
  }
  const e = json as Record<string, unknown> | null;
  if (typeof e !== 'object' || e === null) throw new InvalidEventError('El mensaje no es un objeto');
  if (e.version !== 1) throw new InvalidEventError(`Versión no soportada: ${String(e.version)}`);
  if (e.type !== 'booking.confirmed' && e.type !== 'booking.cancelled') {
    throw new InvalidEventError(`Tipo de evento desconocido: ${String(e.type)}`);
  }
  const d = e.data as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null) throw new InvalidEventError('Falta data');
  return {
    eventId: str(e.eventId, 'eventId'),
    type: e.type,
    occurredAt: date(e.occurredAt, 'occurredAt'),
    version: 1,
    data: {
      bookingId: str(d.bookingId, 'bookingId'),
      courtId: str(d.courtId, 'courtId'),
      courtName: str(d.courtName, 'courtName'),
      venueId: str(d.venueId, 'venueId'),
      venueName: str(d.venueName, 'venueName'),
      playerId: str(d.playerId, 'playerId'),
      ownerId: str(d.ownerId, 'ownerId'),
      startsAt: date(d.startsAt, 'startsAt'),
      endsAt: date(d.endsAt, 'endsAt'),
    },
  };
}

const MATCH_TYPES: MatchEventType[] = ['match.opened', 'match.player_joined', 'match.player_left', 'match.cancelled'];

const member = (v: unknown, name: string): RoomMember => {
  const m = v as Record<string, unknown> | null;
  if (typeof m !== 'object' || m === null) throw new InvalidEventError(`Campo inválido: ${name}`);
  return { id: str(m.id, `${name}.id`), name: str(m.name, `${name}.name`) };
};

function envelope(raw: Buffer | string): Record<string, unknown> {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    throw new InvalidEventError('El mensaje no es JSON');
  }
  const e = json as Record<string, unknown> | null;
  if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new InvalidEventError('El mensaje no es un objeto');
  if (e.version !== 1) throw new InvalidEventError(`Versión no soportada: ${String(e.version)}`);
  return e;
}

/** Valida un evento de partido. Lanza InvalidEventError si no cumple el contrato. */
export function parseMatchEvent(raw: Buffer | string): MatchEvent {
  const e = envelope(raw);
  if (!MATCH_TYPES.includes(e.type as MatchEventType)) throw new InvalidEventError(`Tipo de evento desconocido: ${String(e.type)}`);
  const d = e.data as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null) throw new InvalidEventError('Falta data');
  if (d.status !== 'open' && d.status !== 'cancelled') throw new InvalidEventError('Campo inválido: status');
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) throw new InvalidEventError('Campo inválido: version');
  if (!Array.isArray(d.members) || d.members.length < 1 || d.members.length > 100) throw new InvalidEventError('Campo inválido: members');
  const members = d.members.map((m, i) => member(m, `members[${i}]`));
  const organizerId = str(d.organizerId, 'organizerId');
  if (members[0].id !== organizerId) throw new InvalidEventError('El primer miembro debe ser el organizador');
  return {
    eventId: str(e.eventId, 'eventId'),
    type: e.type as MatchEventType,
    occurredAt: date(e.occurredAt, 'occurredAt'),
    version: 1,
    data: {
      matchId: str(d.matchId, 'matchId'),
      bookingId: str(d.bookingId, 'bookingId'),
      status: d.status,
      version: d.version,
      organizerId,
      members,
      venueName: str(d.venueName, 'venueName'),
      courtName: str(d.courtName, 'courtName'),
      startsAt: date(d.startsAt, 'startsAt'),
      endsAt: date(d.endsAt, 'endsAt'),
      changedPlayer: d.changedPlayer == null ? null : member(d.changedPlayer, 'changedPlayer'),
    },
  };
}

/** Valida cualquier evento del bus, de reserva o de partido, según su `type`. */
export function parseEvent(raw: Buffer | string): ChatEvent {
  const e = envelope(raw);
  if (typeof e.type === 'string' && e.type.startsWith('match.')) return parseMatchEvent(raw);
  return parseBookingEvent(raw);
}
