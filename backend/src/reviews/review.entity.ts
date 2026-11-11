import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Booking } from '../bookings/booking.entity';
import { User } from '../users/user.entity';
import { Venue } from '../venues/venue.entity';

// Una reseña por reserva (índice único): solo quien jugó, y solo una vez por partido.
@Entity('reviews')
@Check('reviews_rating_range', '"rating" BETWEEN 1 AND 5')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'booking_id' })
  bookingId!: string;

  @ManyToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'booking_id' })
  booking!: Booking;

  @Index()
  @Column({ name: 'venue_id' })
  venueId!: string;

  @ManyToOne(() => Venue, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venue_id' })
  venue!: Venue;

  @Column({ name: 'player_id' })
  playerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'player_id' })
  player!: User;

  @Column({ type: 'smallint' })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
