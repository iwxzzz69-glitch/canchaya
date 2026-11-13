import { Booking } from '../bookings/booking.entity';
import { OutboxEvent } from '../events/outbox-event.entity';
import { MatchPlayer } from '../matches/match-player.entity';
import { Match } from '../matches/match.entity';
import { Payment } from '../payments/payment.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/user.entity';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';

// Lista única de entidades: la usan el CLI de migraciones y los tests de integración.
export const ALL_ENTITIES = [User, Venue, Court, Booking, Payment, Review, OutboxEvent, Match, MatchPlayer];
