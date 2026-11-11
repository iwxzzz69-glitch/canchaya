import { Booking } from '../bookings/booking.entity';
import { Payment } from '../payments/payment.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/user.entity';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';

// Lista única de entidades: la usan el CLI de migraciones y los tests de integración.
export const ALL_ENTITIES = [User, Venue, Court, Booking, Payment, Review];
