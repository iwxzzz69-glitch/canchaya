import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';
import { Sport } from './sport.enum';
import { Venue } from './venue.entity';

@Entity('courts')
export class Court {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'venue_id' })
  venueId!: string;

  @ManyToOne(() => Venue, (venue) => venue.courts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venue_id' })
  venue!: Venue;

  @Column()
  name!: string;

  @Index()
  @Column({ type: 'enum', enum: Sport })
  sport!: Sport;

  // Precio por hora en soles. numeric evita errores de redondeo de float.
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    name: 'price_per_hour',
    transformer: numericTransformer,
  })
  pricePerHour!: number;

  // Horario de atención en hora local (ver bookings/local-time.ts): abre en openHour
  // y la última reserva termina como tarde a closeHour. Por defecto 08:00-23:00.
  @Column({ name: 'open_hour', type: 'smallint', default: 8 })
  openHour!: number;

  @Column({ name: 'close_hour', type: 'smallint', default: 23 })
  closeHour!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
