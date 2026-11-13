import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { EventPublisher, PublishedEnvelope } from './event-publisher';

export const DEFAULT_EXCHANGE = 'canchaya.events';

type ConnectFn = (url: string) => Promise<amqp.ChannelModel>;

/**
 * Publica en un exchange `topic` durable de RabbitMQ con confirmaciones del broker (publisher
 * confirms) y mensajes persistentes. Conecta de forma perezosa y se reconecta sola si se cae.
 */
export class AmqpEventPublisher implements EventPublisher {
  private readonly logger = new Logger(AmqpEventPublisher.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private connecting?: Promise<amqp.ConfirmChannel>;

  constructor(
    private readonly url: string,
    private readonly exchange: string = DEFAULT_EXCHANGE,
    private readonly connect: ConnectFn = (u) => amqp.connect(u),
  ) {}

  private async getChannel(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return this.channel;
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async open(): Promise<amqp.ConfirmChannel> {
    const connection = await this.connect(this.url);
    const reset = (reason: string) => {
      this.logger.warn(`Conexión con RabbitMQ perdida (${reason}); se reconectará en la próxima publicación`);
      this.channel = undefined;
      this.connection = undefined;
    };
    connection.on('error', (e: Error) => reset(e.message));
    connection.on('close', () => reset('cerrada'));
    try {
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(this.exchange, 'topic', { durable: true });
      this.connection = connection;
      this.channel = channel;
      return channel;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  async publish(envelope: PublishedEnvelope): Promise<void> {
    const channel = await this.getChannel();
    const body = Buffer.from(JSON.stringify(envelope));
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        this.exchange,
        envelope.type,
        body,
        { persistent: true, messageId: envelope.eventId, contentType: 'application/json', type: envelope.type },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async close() {
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await connection?.close().catch(() => undefined);
  }
}
