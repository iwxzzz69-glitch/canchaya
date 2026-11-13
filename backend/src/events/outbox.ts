import { EntityManager } from 'typeorm';
import { Booking } from '../bookings/booking.entity';
import { MatchPlayer } from '../matches/match-player.entity';
import { Match } from '../matches/match.entity';
import { User } from '../users/user.entity';
import { OutboxEvent } from './outbox-event.entity';

export type BookingEventType = 'booking.confirmed' | 'booking.cancelled';

/** Contrato del mensaje que consume el chat-service (versión 1). */
export interface BookingEventData {
  bookingId: string;
  courtId: string;
  courtName: string;
  venueId: string;
  venueName: string;
  playerId: string;
  ownerId: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Guarda un evento de reserva en la bandeja de salida. Debe llamarse con el `manager` de la
 * transacción que cambia el estado de la reserva.
 */
export async function enqueueBookingEvent(
  manager: EntityManager,
  type: BookingEventType,
  bookingId: string,
): Promise<void> {
  const booking = await manager.findOneOrFail(Booking, {
    where: { id: bookingId },
    relations: { court: { venue: true } },
  });
  const data: BookingEventData = {
    bookingId: booking.id,
    courtId: booking.courtId,
    courtName: booking.court.name,
    venueId: booking.court.venueId,
    venueName: booking.court.venue.name,
    playerId: booking.playerId,
    ownerId: booking.court.venue.ownerId,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
  };
  await manager.save(manager.create(OutboxEvent, { type, payload: { ...data } }));
}

export type MatchEventType = 'match.opened' | 'match.player_joined' | 'match.player_left' | 'match.cancelled';

export interface MatchMember {
  id: string;
  name: string; // solo el primer nombre
}

/**
 * Contrato de los eventos de partido (versión 1). Cada evento trae el estado COMPLETO del partido
 * (instantánea) más su `version`, y no solo "alguien se unió": así el consumidor no depende del
 * orden de llegada ni de duplicados, aplica el de mayor versión y listo.
 */
export interface MatchEventData {
  matchId: string;
  bookingId: string;
  status: 'open' | 'cancelled';
  version: number;
  organizerId: string;
  /** Quienes pueden chatear: el organizador primero, luego los jugadores en orden de llegada. */
  members: MatchMember[];
  venueName: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  /** Quién entró o salió (null en opened y cancelled); sirve para el aviso "X se unió / salió". */
  changedPlayer: MatchMember | null;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

/**
 * Guarda un evento de partido en la bandeja de salida. Debe llamarse DENTRO de la transacción que
 * cambió el partido y DESPUÉS de actualizar su fila (que queda bloqueada hasta confirmar), para que
 * la instantánea y su versión sean coherentes aunque haya varias personas entrando a la vez.
 */
export async function enqueueMatchEvent(
  manager: EntityManager,
  type: MatchEventType,
  matchId: string,
  changedPlayerId: string | null = null,
): Promise<void> {
  const match = await manager.findOneOrFail(Match, {
    where: { id: matchId },
    relations: { organizer: true, booking: { court: { venue: true } } },
  });
  const players = await manager.getRepository(MatchPlayer).find({
    where: { matchId },
    relations: { player: true },
    order: { joinedAt: 'ASC', playerId: 'ASC' },
  });
  const changed = changedPlayerId ? await manager.findOneOrFail(User, { where: { id: changedPlayerId } }) : null;
  const data: MatchEventData = {
    matchId: match.id,
    bookingId: match.bookingId,
    status: match.status,
    version: match.version,
    organizerId: match.organizerId,
    members: [
      { id: match.organizerId, name: firstName(match.organizer.name) },
      ...players.map((p) => ({ id: p.playerId, name: firstName(p.player.name) })),
    ],
    venueName: match.booking.court.venue.name,
    courtName: match.booking.court.name,
    startsAt: match.booking.startsAt.toISOString(),
    endsAt: match.booking.endsAt.toISOString(),
    changedPlayer: changed ? { id: changed.id, name: firstName(changed.name) } : null,
  };
  await manager.save(manager.create(OutboxEvent, { type, payload: { ...data } }));
}
