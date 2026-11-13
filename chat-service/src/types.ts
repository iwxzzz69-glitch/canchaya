export type Role = 'player' | 'owner' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export type RoomStatus = 'open' | 'closed';

export type RoomKind = 'booking' | 'match';

export interface RoomMember {
  id: string;
  name: string; // primer nombre
}

/**
 * Hay dos tipos de sala:
 *  - 'booking': una por reserva confirmada, entre el jugador y el dueño del local (id = id de la reserva).
 *  - 'match': una por partido abierto, entre el organizador y quienes se unen (id = `match:<id del partido>`).
 * Quién puede entrar lo dice siempre `memberIds`.
 */
export interface Room {
  id: string;
  kind: RoomKind;
  status: RoomStatus;
  memberIds: string[];
  /** Nombres para mostrar; solo en salas de partido. */
  members: RoomMember[];
  playerId: string; // reserva: quien reservó; partido: el organizador
  ownerId: string | null; // reserva: dueño del local; partido: null
  bookingId: string | null; // partido: la reserva que lo respalda
  /** Versión del último estado de partido aplicado (solo partidos); descarta eventos viejos. */
  version: number | null;
  venueName: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export const SYSTEM_SENDER = 'system';

export interface Message {
  id: string; // ordenable: la mitad izquierda es la hora; sirve como cursor de paginación
  roomId: string;
  /** Quién lo escribió; 'system' para avisos ("Luis se unió al partido"). */
  senderId: string;
  kind: 'user' | 'system';
  text: string;
  createdAt: string;
}

export type BookingEventType = 'booking.confirmed' | 'booking.cancelled';

/** Mensaje que publica el monolito (contrato versión 1). */
export interface BookingEvent {
  eventId: string;
  type: BookingEventType;
  occurredAt: string;
  version: 1;
  data: {
    bookingId: string;
    courtId: string;
    courtName: string;
    venueId: string;
    venueName: string;
    playerId: string;
    ownerId: string;
    startsAt: string;
    endsAt: string;
  };
}

export type MatchEventType = 'match.opened' | 'match.player_joined' | 'match.player_left' | 'match.cancelled';

/** Mensaje de partido que publica el monolito (contrato versión 1): estado completo + versión. */
export interface MatchEvent {
  eventId: string;
  type: MatchEventType;
  occurredAt: string;
  version: 1;
  data: {
    matchId: string;
    bookingId: string;
    status: 'open' | 'cancelled';
    version: number;
    organizerId: string;
    members: RoomMember[];
    venueName: string;
    courtName: string;
    startsAt: string;
    endsAt: string;
    changedPlayer: RoomMember | null;
  };
}

export type ChatEvent = BookingEvent | MatchEvent;

export const matchRoomId = (matchId: string) => `match:${matchId}`;
