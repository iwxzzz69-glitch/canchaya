import { AmqpEventPublisher } from './amqp.publisher';
import { PublishedEnvelope } from './event-publisher';

const envelope: PublishedEnvelope = {
  eventId: 'e-1',
  type: 'booking.confirmed',
  occurredAt: '2026-11-10T00:00:00.000Z',
  version: 1,
  data: { bookingId: 'b-1' },
};

function fakeBroker() {
  const state = {
    connects: 0,
    published: [] as { exchange: string; key: string; body: string; options: Record<string, unknown> }[],
    nack: false,
    handlers: {} as Record<string, () => void>,
    asserted: [] as unknown[][],
  };
  const channel = {
    assertExchange: jest.fn(async (...args: unknown[]) => void state.asserted.push(args)),
    publish: jest.fn((exchange: string, key: string, body: Buffer, options: Record<string, unknown>, cb: (e?: Error) => void) => {
      state.published.push({ exchange, key, body: body.toString(), options });
      cb(state.nack ? new Error('nack del broker') : undefined);
      return true;
    }),
  };
  const connection = {
    on: (event: string, fn: () => void) => void (state.handlers[event] = fn),
    createConfirmChannel: jest.fn(async () => channel),
    close: jest.fn(async () => undefined),
  };
  const connect = jest.fn(async () => {
    state.connects++;
    return connection as never;
  });
  return { state, channel, connection, connect };
}

describe('AmqpEventPublisher', () => {
  it('declara un exchange topic durable y publica mensajes persistentes con la clave del tipo', async () => {
    const b = fakeBroker();
    await new AmqpEventPublisher('amqp://x', 'canchaya.events', b.connect).publish(envelope);

    expect(b.state.asserted[0]).toEqual(['canchaya.events', 'topic', { durable: true }]);
    const [msg] = b.state.published;
    expect(msg.exchange).toBe('canchaya.events');
    expect(msg.key).toBe('booking.confirmed');
    expect(JSON.parse(msg.body)).toEqual(envelope);
    expect(msg.options).toMatchObject({ persistent: true, messageId: 'e-1', contentType: 'application/json' });
  });

  it('reutiliza la conexión entre publicaciones, también las simultáneas', async () => {
    const b = fakeBroker();
    const p = new AmqpEventPublisher('amqp://x', 'ex', b.connect);
    await Promise.all([p.publish(envelope), p.publish(envelope), p.publish(envelope)]);
    await p.publish(envelope);
    expect(b.state.connects).toBe(1);
    expect(b.state.published).toHaveLength(4);
  });

  it('si el broker rechaza el mensaje (nack), la publicación falla', async () => {
    const b = fakeBroker();
    b.state.nack = true;
    await expect(new AmqpEventPublisher('amqp://x', 'ex', b.connect).publish(envelope)).rejects.toThrow('nack del broker');
  });

  it('si no puede conectar, falla y reintenta conectar en la siguiente publicación', async () => {
    const b = fakeBroker();
    b.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const p = new AmqpEventPublisher('amqp://x', 'ex', b.connect);
    await expect(p.publish(envelope)).rejects.toThrow('ECONNREFUSED');
    await expect(p.publish(envelope)).resolves.toBeUndefined();
  });

  it('se reconecta tras perder la conexión', async () => {
    const b = fakeBroker();
    const p = new AmqpEventPublisher('amqp://x', 'ex', b.connect);
    await p.publish(envelope);
    b.state.handlers.close(); // el broker se cayó
    await p.publish(envelope);
    expect(b.state.connects).toBe(2);
  });

  it('cierra la conexión al apagarse', async () => {
    const b = fakeBroker();
    const p = new AmqpEventPublisher('amqp://x', 'ex', b.connect);
    await p.publish(envelope);
    await p.close();
    expect(b.connection.close).toHaveBeenCalled();
  });
});
