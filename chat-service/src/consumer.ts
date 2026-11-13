import amqp from 'amqplib';
import { InvalidEventError, parseEvent } from './events';
import { ChatStore, MatchApplyResult } from './store/types';
import { BookingEvent, ChatEvent, MatchEvent, Room } from './types';

export const EXCHANGE = 'canchaya.events';
// Nombre nuevo a propósito: el esqueleto de la Fase 0 ya había declarado "chat.booking-events" sin
// cola de mensajes muertos, y RabbitMQ no permite redeclarar una cola con argumentos distintos.
export const QUEUE = 'chat.bookings';
// Los partidos van en su propia cola (y su propia cola de muertos): así un problema con un tipo de
// evento no frena al otro, y no hubo que tocar la cola que ya existía en instalaciones anteriores.
export const MATCH_QUEUE = 'chat.matches';
export const BINDINGS: { queue: string; key: string }[] = [
  { queue: QUEUE, key: 'booking.*' },
  { queue: MATCH_QUEUE, key: 'match.*' },
];

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DeliveryDeps {
  store: ChatStore;
  log: Logger;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Se llama tras aplicar un evento de reserva (el gateway avisa a los clientes conectados). */
  onApplied?: (event: BookingEvent, closedMatchRooms: Room[]) => void | Promise<void>;
  /** Ídem para un evento de partido; solo se llama si el evento cambió algo (no si era repetido o viejo). */
  onMatchApplied?: (event: MatchEvent, result: MatchApplyResult) => void | Promise<void>;
}

const isMatchEvent = (e: ChatEvent): e is MatchEvent => e.type.startsWith('match.');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Procesa un mensaje del bus y decide su destino:
 *  - 'ack':  aplicado (o duplicado, que es lo mismo porque aplicar es idempotente).
 *  - 'dead': mensaje inválido o que falló tras varios intentos; va a la cola de mensajes muertos
 *            para revisarlo, en vez de bloquear la cola o perderse en silencio.
 */
export async function processDelivery(raw: Buffer, deps: DeliveryDeps): Promise<'ack' | 'dead'> {
  const { store, log, maxAttempts = 3, retryDelayMs = 200 } = deps;
  let event: ChatEvent;
  try {
    event = parseEvent(raw);
  } catch (error) {
    if (error instanceof InvalidEventError) {
      log.error(`Evento descartado a la cola de muertos: ${error.message}`);
      return 'dead';
    }
    throw error;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let notify: () => void | Promise<void> = () => undefined;
      if (isMatchEvent(event)) {
        const match = event;
        const result = await store.applyMatchEvent(match);
        if (result.applied) notify = () => deps.onMatchApplied?.(match, result);
        log.info(`Evento ${event.type} ${result.applied ? 'aplicado' : 'ignorado (versión ya vista)'} (partido ${match.data.matchId}, v${match.data.version})`);
      } else {
        const booking = event;
        const result = await store.applyBookingEvent(booking);
        notify = () => deps.onApplied?.(booking, result?.closedMatchRooms ?? []);
        log.info(`Evento ${event.type} aplicado (reserva ${booking.data.bookingId})`);
      }
      try {
        await notify();
      } catch (error) {
        // Avisar a los clientes es un extra: no debe reintentar ni perder el evento ya aplicado.
        log.warn(`No se pudo notificar a los clientes: ${(error as Error).message}`);
      }
      return 'ack';
    } catch (error) {
      log.warn(`Intento ${attempt}/${maxAttempts} fallido para ${event.eventId}: ${(error as Error).message}`);
      if (attempt < maxAttempts) await sleep(retryDelayMs * 2 ** (attempt - 1));
    }
  }
  log.error(`Evento ${event.eventId} enviado a la cola de muertos tras ${maxAttempts} intentos`);
  return 'dead';
}

export interface ConsumerOptions extends DeliveryDeps {
  url: string;
  exchange?: string;
  connect?: (url: string) => Promise<amqp.ChannelModel>;
}

/** Declara el exchange y, para cada cola, su cola de mensajes muertos y su enlace. */
export async function assertTopology(ch: amqp.Channel, exchange = EXCHANGE) {
  await ch.assertExchange(exchange, 'topic', { durable: true });
  for (const { queue, key } of BINDINGS) {
    // La de reservas conserva su nombre original (`canchaya.events.dlx`) para no romper instalaciones
    // anteriores; la de partidos usa uno propio.
    const dlxName = queue === QUEUE ? `${exchange}.dlx` : `${exchange}.${queue}.dlx`;
    await ch.assertExchange(dlxName, 'fanout', { durable: true });
    await ch.assertQueue(`${queue}.dead`, { durable: true });
    await ch.bindQueue(`${queue}.dead`, dlxName, '');
    await ch.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': dlxName } });
    await ch.bindQueue(queue, exchange, key);
  }
}

/** Consume eventos y se reconecta sola (con espera creciente) si RabbitMQ no está o se cae. */
export function startConsumer(options: ConsumerOptions): { close(): Promise<void> } {
  const { url, log, connect = (u: string) => amqp.connect(u) } = options;
  let stopped = false;
  let connection: amqp.ChannelModel | undefined;
  let delay = 1000;

  const run = async () => {
    while (!stopped) {
      try {
        connection = await connect(url);
        const lost = new Promise<void>((resolve) => {
          connection!.on('close', () => resolve());
          connection!.on('error', (e: Error) => log.warn(`RabbitMQ: ${e.message}`));
        });
        const ch = await connection.createChannel();
        await assertTopology(ch, options.exchange);
        await ch.prefetch(10);
        for (const { queue } of BINDINGS) {
          await ch.consume(queue, (msg) => {
            if (!msg) return;
            processDelivery(msg.content, options)
              .then((decision) => (decision === 'ack' ? ch.ack(msg) : ch.nack(msg, false, false)))
              .catch((error: Error) => {
                log.error(`Error inesperado procesando mensaje: ${error.message}`);
                ch.nack(msg, false, true); // se reintenta: no se pierde
              });
          });
        }
        log.info('Consumidor de eventos conectado a RabbitMQ');
        delay = 1000;
        await lost;
        if (!stopped) log.warn('Conexión con RabbitMQ cerrada; reconectando...');
      } catch (error) {
        if (!stopped) log.warn(`RabbitMQ no disponible (${(error as Error).message}); reintento en ${delay / 1000}s`);
      }
      if (stopped) break;
      await sleep(delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void run();

  return {
    async close() {
      stopped = true;
      await connection?.close().catch(() => undefined);
    },
  };
}
