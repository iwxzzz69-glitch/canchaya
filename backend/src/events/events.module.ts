import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmqpEventPublisher } from './amqp.publisher';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { NoopEventPublisher } from './noop.publisher';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxRelay } from './outbox.relay';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [
    {
      provide: EVENT_PUBLISHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EventPublisher => {
        const url = config.get<string>('RABBITMQ_URL');
        if (!url) return new NoopEventPublisher();
        new Logger('Events').log('Eventos de reserva hacia RabbitMQ (bandeja de salida + confirmaciones)');
        return new AmqpEventPublisher(url, config.get<string>('EVENTS_EXCHANGE') || undefined);
      },
    },
    OutboxRelay,
  ],
  exports: [OutboxRelay],
})
export class EventsModule {}
