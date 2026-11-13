import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { OutboxEvent } from './outbox-event.entity';

const BATCH_SIZE = 50;

/**
 * Lee la bandeja de salida y publica los eventos pendientes en orden de creación.
 *  - `FOR UPDATE SKIP LOCKED`: varias instancias del monolito pueden correr el relevo sin publicar
 *    dos veces el mismo evento a la vez.
 *  - Si el bus falla, el evento sigue pendiente y se reintenta; nunca se pierde. Se detiene en el
 *    primer fallo para no adelantar eventos posteriores.
 *  - Entrega "al menos una vez": un corte entre publicar y marcar puede repetir un evento. Cada
 *    mensaje lleva `eventId` y el consumidor es idempotente.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const interval = Number(this.config.get('EVENTS_POLL_MS')) || 1000;
    if (this.config.get('EVENTS_RELAY') === 'off') return; // los tests lo llaman a mano
    this.timer = setInterval(() => void this.flush(), interval);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.publisher.close?.();
  }

  /** Publica lo pendiente. Devuelve cuántos eventos se entregaron. */
  async flush(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.dataSource.transaction(async (manager) => {
        const pending = await manager
          .getRepository(OutboxEvent)
          .createQueryBuilder('e')
          .where('e.publishedAt IS NULL')
          .orderBy('e.createdAt', 'ASC')
          .addOrderBy('e.id', 'ASC')
          .limit(BATCH_SIZE)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();

        let delivered = 0;
        for (const event of pending) {
          try {
            await this.publisher.publish({
              eventId: event.id,
              type: event.type,
              occurredAt: event.createdAt.toISOString(),
              version: 1,
              data: event.payload,
            });
          } catch (error) {
            const message = (error as Error).message;
            await manager.update(OutboxEvent, { id: event.id }, { attempts: () => 'attempts + 1', lastError: message.slice(0, 500) });
            this.logger.warn(`No se pudo publicar ${event.type} (${event.id}): ${message}`);
            break;
          }
          await manager.update(OutboxEvent, { id: event.id }, { publishedAt: () => 'now()' });
          delivered++;
        }
        return delivered;
      });
    } catch (error) {
      this.logger.error(`Fallo del relevo de eventos: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
