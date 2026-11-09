import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
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
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  pricePerHour!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
