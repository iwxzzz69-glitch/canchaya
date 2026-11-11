import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Booking } from '../bookings/booking.entity';
import { numericTransformer } from '../common/numeric.transformer';
import { PaymentStatus } from './payment-status.enum';

/**
 * Una reserva solo puede tener un pago "vivo" a la vez (en curso o aprobado). Es un índice único
 * parcial en la base de datos: si el jugador pulsa "pagar" dos veces o dos pestañas lo intentan,
 * solo una crea el intento y solo una llega a cobrar. Los pagos fallidos o devueltos no cuentan,
 * así que tras un rechazo se puede reintentar con otra tarjeta.
 */
@Entity('payments')
@Index('payments_one_active_per_booking', ['bookingId'], {
  unique: true,
  where: `"status" IN ('processing', 'succeeded')`,
})
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'booking_id' })
  bookingId!: string;

  @ManyToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'booking_id' })
  booking!: Booking;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  amount!: number;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  // 'culqi' o 'fake' (pasarela simulada de desarrollo).
  @Column({ type: 'varchar', length: 20 })
  provider!: string;

  @Index()
  @Column({ name: 'provider_charge_id', type: 'varchar', nullable: true })
  providerChargeId!: string | null;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.Processing })
  status!: PaymentStatus;

  @Column({ name: 'failure_code', type: 'varchar', nullable: true })
  failureCode!: string | null;

  @Column({ name: 'failure_message', type: 'varchar', nullable: true })
  failureMessage!: string | null;

  @Column({ name: 'refund_id', type: 'varchar', nullable: true })
  refundId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
