import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bandeja de salida (patrón "transactional outbox"). El evento se guarda en la MISMA transacción que
 * el cambio de estado que lo origina, así que nunca puede haber una reserva confirmada sin su evento
 * ni un evento de algo que se revirtió. Un relevo publica después los pendientes en RabbitMQ.
 */
@Entity('outbox_events')
@Index('outbox_events_pending', ['createdAt', 'id'], { where: `"published_at" IS NULL` })
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Clave de ruteo en RabbitMQ: booking.confirmed, booking.cancelled, match.opened, match.player_joined, match.player_left, match.cancelled. */
  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;
}
