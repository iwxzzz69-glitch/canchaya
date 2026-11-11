import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';
import { User } from '../users/user.entity';
import { Court } from '../venues/court.entity';
import { BookingStatus } from './booking-status.enum';

/**
 * La garantía de "nadie reserva el mismo horario dos veces" vive en la base de datos:
 * la restricción de exclusión impide que dos reservas activas (pending o confirmed) de la
 * misma cancha tengan rangos de tiempo que se solapen. El rango es [inicio, fin), así que
 * una reserva de 10:00-11:00 y otra de 11:00-12:00 sí pueden coexistir.
 * Requiere la extensión btree_gist (la crea la migración).
 */
@Entity('bookings')
@Check('bookings_ends_after_start', '"ends_at" > "starts_at"')
@Exclusion(
  'bookings_no_overlap',
  `USING gist ("court_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" IN ('pending', 'confirmed'))`,
)
@Index(['status', 'expiresAt'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'court_id' })
  courtId!: string;

  @ManyToOne(() => Court, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'court_id' })
  court!: Court;

  @Index()
  @Column({ name: 'player_id' })
  playerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'player_id' })
  player!: User;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.Pending })
  status!: BookingStatus;

  // Precio total fijado al reservar: si el dueño cambia la tarifa después, no afecta reservas hechas.
  @Column({
    name: 'total_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  totalPrice!: number;

  // Solo para reservas pending: hasta cuándo se mantiene bloqueado el horario.
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
