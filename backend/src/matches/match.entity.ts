import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Booking } from '../bookings/booking.entity';
import { User } from '../users/user.entity';
import { MatchLevel } from './match-level.enum';
import { MatchStatus } from './match-status.enum';

/**
 * Un partido abierto: quien tiene una reserva confirmada busca jugadores para completar el equipo.
 *
 * `spotsTotal` son los lugares que faltan (el organizador no cuenta) y `spotsTaken` cuántos ya se
 * ocuparon. Que nunca haya más jugadores que lugares lo garantiza la base de datos con el CHECK, y
 * la aplicación ocupa lugares con un UPDATE atómico, así que dos personas no pueden tomar el último.
 */
@Entity('matches')
@Check('matches_spots_in_range', '"spots_total" BETWEEN 1 AND 20')
@Check('matches_spots_taken_in_range', '"spots_taken" >= 0 AND "spots_taken" <= "spots_total"')
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Un partido por reserva: OneToOne ya crea la restricción de unicidad.
  @Column({ name: 'booking_id' })
  bookingId!: string;

  @OneToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'booking_id' })
  booking!: Booking;

  @Index()
  @Column({ name: 'organizer_id' })
  organizerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizer_id' })
  organizer!: User;

  @Column({ name: 'spots_total', type: 'smallint' })
  spotsTotal!: number;

  @Column({ name: 'spots_taken', type: 'smallint', default: 0 })
  spotsTaken!: number;

  @Column({ type: 'enum', enum: MatchLevel, default: MatchLevel.Casual })
  level!: MatchLevel;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes!: string | null;

  /**
   * Sube en +1 con cada cambio (abrir, entrar, salir, cancelar). Como todos esos cambios actualizan
   * esta misma fila, PostgreSQL los ordena; el chat usa este número para descartar eventos viejos
   * o repetidos y quedarse siempre con el estado más reciente, llegue como llegue el mensaje.
   */
  @Column({ type: 'int', default: 0 })
  version!: number;

  @Index()
  @Column({ type: 'enum', enum: MatchStatus, default: MatchStatus.Open })
  status!: MatchStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
