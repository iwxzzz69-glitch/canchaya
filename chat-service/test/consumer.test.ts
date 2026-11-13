import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertTopology, EXCHANGE, MATCH_QUEUE, processDelivery, QUEUE, startConsumer } from '../src/consumer';
import { MemoryChatStore } from '../src/store/memory';
import { BookingEvent } from '../src/types';
import { bookingEvent, matchEvent, silent } from './helpers';

const raw = (o: unknown) => Buffer.from(JSON.stringify(o));
const fast = { log: silent, retryDelayMs: 1 };

describe('processDelivery', () => {
  it('aplica un evento válido, abre la sala y avisa a los clientes', async () => {
    const store = new MemoryChatStore();
    const applied: BookingEvent[] = [];
    const e = bookingEvent('booking.confirmed', 'b1');
    assert.equal(await processDelivery(raw(e), { ...fast, store, onApplied: (ev) => void applied.push(ev) }), 'ack');
    assert.equal((await store.getRoom('b1'))?.status, 'open');
    assert.deepEqual(applied.map((a) => a.eventId), [e.eventId]);
  });

  it('un mensaje repetido se confirma sin efectos extra', async () => {
    const store = new MemoryChatStore();
    const e = bookingEvent('booking.confirmed', 'b1');
    assert.equal(await processDelivery(raw(e), { ...fast, store }), 'ack');
    assert.equal(await processDelivery(raw(e), { ...fast, store }), 'ack');
    assert.equal((await store.listRoomsFor('p1')).length, 1);
  });

  it('un mensaje inválido va a la cola de muertos sin tocar el almacén', async () => {
    const store = new MemoryChatStore();
    let calls = 0;
    store.applyBookingEvent = async () => void calls++;
    for (const bad of [Buffer.from('basura'), raw({ ...bookingEvent('booking.confirmed'), version: 9 }), raw({})]) {
      assert.equal(await processDelivery(bad, { ...fast, store }), 'dead');
    }
    assert.equal(calls, 0);
  });

  it('reintenta ante un fallo pasajero del almacén y termina aplicando', async () => {
    const store = new MemoryChatStore();
    const original = store.applyBookingEvent.bind(store);
    let failures = 2;
    store.applyBookingEvent = async (e) => {
      if (failures-- > 0) throw new Error('mongo caído');
      return original(e);
    };
    assert.equal(await processDelivery(raw(bookingEvent('booking.confirmed', 'b2')), { ...fast, store }), 'ack');
    assert.equal((await store.getRoom('b2'))?.status, 'open');
  });

  it('si el almacén sigue fallando, tras los intentos va a la cola de muertos', async () => {
    const store = new MemoryChatStore();
    let calls = 0;
    store.applyBookingEvent = async () => {
      calls++;
      throw new Error('mongo caído');
    };
    assert.equal(await processDelivery(raw(bookingEvent('booking.confirmed')), { ...fast, store, maxAttempts: 3 }), 'dead');
    assert.equal(calls, 3);
  });

  it('si avisar a los clientes falla, el evento igual queda aplicado y confirmado', async () => {
    const store = new MemoryChatStore();
    const decision = await processDelivery(raw(bookingEvent('booking.confirmed', 'b3')), {
      ...fast,
      store,
      onApplied: () => {
        throw new Error('socket roto');
      },
    });
    assert.equal(decision, 'ack');
    assert.ok(await store.getRoom('b3'));
  });
});

describe('processDelivery con eventos de partido', () => {
  const A: [string, string] = ['ana', 'Ana'];
  const L: [string, string] = ['luis', 'Luis'];

  it('aplica el evento, avisa a los clientes y confirma', async () => {
    const store = new MemoryChatStore();
    const seen: string[] = [];
    const deps = { ...fast, store, onMatchApplied: (e: any, r: any) => void seen.push(`${e.type}:${r.applied}`) };
    assert.equal(await processDelivery(raw(matchEvent('match.opened', 'm1', 1, [A])), deps), 'ack');
    assert.equal(await processDelivery(raw(matchEvent('match.player_joined', 'm1', 2, [A, L], { changed: L })), deps), 'ack');
    assert.deepEqual(seen, ['match.opened:true', 'match.player_joined:true']);
    assert.deepEqual((await store.getRoom('match:m1'))?.memberIds, ['ana', 'luis']);
  });

  it('un evento repetido o viejo se confirma sin avisar de nuevo a los clientes', async () => {
    const store = new MemoryChatStore();
    let notified = 0;
    const deps = { ...fast, store, onMatchApplied: () => void notified++ };
    const joined = raw(matchEvent('match.player_joined', 'm2', 2, [A, L], { changed: L }));
    assert.equal(await processDelivery(joined, deps), 'ack');
    assert.equal(await processDelivery(joined, deps), 'ack');
    assert.equal(await processDelivery(raw(matchEvent('match.opened', 'm2', 1, [A])), deps), 'ack');
    assert.equal(notified, 1);
  });

  it('un evento de partido inválido va a la cola de muertos', async () => {
    const bad = { ...matchEvent('match.opened', 'm3', 1, [A]), data: { ...matchEvent('match.opened', 'm3', 1, [A]).data, members: [] } };
    assert.equal(await processDelivery(raw(bad), { ...fast, store: new MemoryChatStore() }), 'dead');
  });

  it('si el almacén falla, reintenta y al final va a muertos', async () => {
    const store = new MemoryChatStore();
    let calls = 0;
    store.applyMatchEvent = async () => {
      calls++;
      throw new Error('mongo caído');
    };
    assert.equal(await processDelivery(raw(matchEvent('match.opened', 'm4', 1, [A])), { ...fast, store, maxAttempts: 3 }), 'dead');
    assert.equal(calls, 3);
  });

  it('al cancelar una reserva, avisa qué salas de partido se cerraron', async () => {
    const store = new MemoryChatStore();
    await store.applyMatchEvent(matchEvent('match.opened', 'm5', 1, [A], { bookingId: 'rsv' }));
    let closed: string[] = [];
    await processDelivery(raw(bookingEvent('booking.cancelled', 'rsv')), { ...fast, store, onApplied: (_e, rooms) => void (closed = rooms.map((r) => r.id)) });
    assert.deepEqual(closed, ['match:m5']);
  });
});

describe('topología de RabbitMQ', () => {
  it('declara exchange topic y, por cada cola, su cola de muertos y su enlace (booking.* y match.*)', async () => {
    const calls: [string, ...unknown[]][] = [];
    const ch: any = new Proxy({}, { get: (_t, name: string) => async (...args: unknown[]) => void calls.push([name, ...args]) });
    await assertTopology(ch);
    assert.deepEqual(calls, [
      ['assertExchange', EXCHANGE, 'topic', { durable: true }],
      ['assertExchange', `${EXCHANGE}.dlx`, 'fanout', { durable: true }],
      ['assertQueue', `${QUEUE}.dead`, { durable: true }],
      ['bindQueue', `${QUEUE}.dead`, `${EXCHANGE}.dlx`, ''],
      ['assertQueue', QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': `${EXCHANGE}.dlx` } }],
      ['bindQueue', QUEUE, EXCHANGE, 'booking.*'],
      ['assertExchange', `${EXCHANGE}.${MATCH_QUEUE}.dlx`, 'fanout', { durable: true }],
      ['assertQueue', `${MATCH_QUEUE}.dead`, { durable: true }],
      ['bindQueue', `${MATCH_QUEUE}.dead`, `${EXCHANGE}.${MATCH_QUEUE}.dlx`, ''],
      ['assertQueue', MATCH_QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': `${EXCHANGE}.${MATCH_QUEUE}.dlx` } }],
      ['bindQueue', MATCH_QUEUE, EXCHANGE, 'match.*'],
    ]);
  });

  it('no reutiliza la cola que declaró el esqueleto de la Fase 0 (argumentos incompatibles)', () => {
    assert.notEqual(QUEUE, 'chat.booking-events');
  });
});

function fakeBroker() {
  const state = {
    connects: 0,
    consumer: undefined as undefined | ((msg: { content: Buffer } | null) => void),
    queues: [] as string[],
    acked: [] as unknown[],
    nacked: [] as { msg: unknown; requeue: boolean }[],
    closeHandlers: [] as (() => void)[],
  };
  const channel = {
    assertExchange: async () => {},
    assertQueue: async () => {},
    bindQueue: async () => {},
    prefetch: async () => {},
    consume: async (q: string, fn: (m: any) => void) => {
      state.queues.push(q);
      state.consumer = fn;
    },
    ack: (m: unknown) => void state.acked.push(m),
    nack: (m: unknown, _all: boolean, requeue: boolean) => void state.nacked.push({ msg: m, requeue }),
  };
  const connect = async () => {
    state.connects++;
    return {
      on: (ev: string, fn: () => void) => ev === 'close' && state.closeHandlers.push(fn),
      createChannel: async () => channel,
      close: async () => {},
    } as any;
  };
  return { state, connect };
}
const until = async (cond: () => boolean, ms = 1500) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('startConsumer', () => {
  it('confirma (ack) los válidos y manda a muertos (nack sin reencolar) los inválidos', async () => {
    const b = fakeBroker();
    const store = new MemoryChatStore();
    const consumer = startConsumer({ url: 'amqp://x', store, log: silent, retryDelayMs: 1, connect: b.connect });
    await until(() => b.state.consumer !== undefined);
    const good = { content: raw(bookingEvent('booking.confirmed', 'b9')) };
    const bad = { content: Buffer.from('no json') };
    b.state.consumer!(good);
    b.state.consumer!(bad);
    await until(() => b.state.acked.length + b.state.nacked.length === 2);
    assert.deepEqual(b.state.acked, [good]);
    assert.deepEqual(b.state.nacked, [{ msg: bad, requeue: false }]);
    assert.ok(await store.getRoom('b9'));
    await consumer.close();
  });

  it('consume tanto la cola de reservas como la de partidos', async () => {
    const b = fakeBroker();
    const consumer = startConsumer({ url: 'amqp://x', store: new MemoryChatStore(), log: silent, connect: b.connect });
    await until(() => b.state.queues.length === 2);
    assert.deepEqual(b.state.queues, [QUEUE, MATCH_QUEUE]);
    await consumer.close();
  });

  it('un fallo inesperado del propio procesamiento reencola el mensaje en vez de perderlo', async () => {
    const b = fakeBroker();
    let first = true;
    const log = {
      ...silent,
      error() {
        if (first) {
          first = false;
          throw new Error('fallo fuera de lo previsto');
        }
      },
    };
    const consumer = startConsumer({ url: 'amqp://x', store: new MemoryChatStore(), log, connect: b.connect });
    await until(() => b.state.consumer !== undefined);
    const msg = { content: Buffer.from('mensaje inválido') };
    b.state.consumer!(msg);
    await until(() => b.state.nacked.length === 1);
    assert.deepEqual(b.state.nacked, [{ msg, requeue: true }]); // no se pierde
    b.state.consumer!(msg); // el broker lo vuelve a entregar y ahora sí se resuelve
    await until(() => b.state.nacked.length === 2);
    assert.deepEqual(b.state.nacked[1], { msg, requeue: false }); // inválido => cola de muertos
    await consumer.close();
  });

  it('se reconecta cuando se pierde la conexión', async () => {
    const b = fakeBroker();
    const consumer = startConsumer({ url: 'amqp://x', store: new MemoryChatStore(), log: silent, connect: b.connect });
    await until(() => b.state.connects === 1 && b.state.consumer !== undefined);
    b.state.closeHandlers.forEach((h) => h()); // RabbitMQ se cae
    await until(() => b.state.connects === 2, 4000);
    await consumer.close();
  });
});
