import { Logger } from '@nestjs/common';
import { EventPublisher, PublishedEnvelope } from './event-publisher';

/** Sin RABBITMQ_URL no se publica nada: los eventos esperan en la bandeja hasta que haya bus. */
export class NoopEventPublisher implements EventPublisher {
  private warned = false;

  async publish(_envelope: PublishedEnvelope): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      new Logger(NoopEventPublisher.name).warn('RABBITMQ_URL no está definida: los eventos quedan en la bandeja de salida');
    }
    throw new Error('Sin bus de eventos configurado');
  }
}
