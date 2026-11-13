import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Booking } from '../bookings/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { Payment } from '../payments/payment.entity';
import { PaymentsService } from '../payments/payments.service';
import { FakePaymentProvider } from '../payments/providers/fake.provider';
import { createTestDatabase, destroyTestDatabase, hasDatabase, seedBasics, slot } from '../testing/test-database';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { EventPublisher, PublishedEnvelope } from './event-publisher';
import { NoopEventPublisher } from './noop.publisher';
import { OutboxEvent } from './outbox-event.entity';
import { enqueueBookingEvent } from './outbox';
import { OutboxRelay } from './outbox.relay';

/** Eventos de reserva y bandeja de salida contra PostgreSQL real (base `canchaya_test_events`). */
const describeDb = hasDatabase ? describe : describe.skip;
const DB = 'canchaya_test_events';
const WEBHOOK = 'secreto';

class RecordingPublisher implements EventPublisher {
  sent: PublishedEnvelope[] = [];
  failTimes = 0;
  delayMs = 0;
  async publish(e: PublishedEnvelope) {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new Error('broker caído');
    }
    this.sent.push(e);
  }
}

describeDb('Eventos de reserva (outbox + relevo, PostgreSQL real)', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let provider: FakePaymentProvider;
  let payments: PaymentsService;
  let bookings: BookingsService;
  let owner: AuthUser;
  let players: AuthUser[];
  let courtId: string;
  let venueId: string;
  let hour: number;

  beforeAll(async () => {
    ds = await createTestDatabase(DB);
    const seed = await seedBasics(ds, 3);
    ({ players, courtId, venueId, owner } = seed);
  });
  afterAll(() => destroyTestDatabase(ds, DB));

  beforeEach(async () => {
    await ds.query('TRUNCATE outbox_events, payments, bookings CASCADE');
    provider = new FakePaymentProvider();
    const config = new ConfigService({ CULQI_WEBHOOK_SECRET: WEBHOOK, BOOKING_HOLD_MINUTES: 10 });
    payments = new PaymentsService(ds.getRepository(Payment), ds.getRepository(Booking), ds, provider, config);
    bookings = new BookingsService(ds.getRepository(Booking), ds.getRepository(Court), ds.getRepository(Venue), payments, config);
    hour = 8;
  });

  const newBooking = (p = players[0]) => bookings.create(p, { courtId, startsAt: slot(hour++) });
  const events = () => ds.getRepository(OutboxEvent).find({ order: { createdAt: 'ASC', id: 'ASC' } });
  const types = async () => (await events()).map((e) => e.type);
  const relay = (publisher: EventPublisher) =>
    new OutboxRelay(ds, publisher, new ConfigService({ EVENTS_RELAY: 'off' }));

  describe('qué cambios generan eventos', () => {
    it('pagar deja un booking.confirmed con todo lo que necesita el chat', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');

      const [event] = await events();
      expect(await types()).toEqual(['booking.confirmed']);
      expect(event.publishedAt).toBeNull();
      expect(event.payload).toEqual({
        bookingId: b.id,
        courtId,
        courtName: 'Cancha 1',
        venueId,
        venueName: 'Local',
        playerId: players[0].id,
        ownerId: owner.id,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
      });
    });

    it('un pago rechazado o con la pasarela caída no genera eventos', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_declined').catch(() => undefined);
      await payments.pay(players[0], b.id, 'tkn_test_unavailable').catch(() => undefined);
      expect(await types()).toEqual([]);
    });

    it('10 pagos simultáneos generan un único evento', async () => {
      const b = await newBooking();
      await Promise.allSettled(Array.from({ length: 10 }, () => payments.pay(players[0], b.id, 'tkn_test_ok')));
      expect(await types()).toEqual(['booking.confirmed']);
    });

    it('confirmar por webhook genera el evento una sola vez aunque el aviso se repita', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_charged_then_unavailable').catch(() => undefined);
      const [chargeId] = [...provider.charges.keys()];
      const event = { type: 'charge.creation.succeeded', data: { id: chargeId } };
      await Promise.all([payments.handleWebhook(WEBHOOK, event), payments.handleWebhook(WEBHOOK, event)]);
      await payments.handleWebhook(WEBHOOK, event);
      expect(await types()).toEqual(['booking.confirmed']);
    });

    it('si se cobró pero la reserva ya estaba cancelada (devolución automática), no se anuncia nada', async () => {
      const b = await newBooking();
      provider.onChargeCreated = async () => {
        await ds.query(`UPDATE bookings SET status='cancelled', expires_at=NULL WHERE id=$1`, [b.id]);
      };
      await payments.pay(players[0], b.id, 'tkn_test_ok').catch(() => undefined);
      expect(await types()).toEqual([]);
    });

    it('cancelar una reserva confirmada deja booking.cancelled después del confirmed', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await bookings.cancel(players[0], b.id);
      expect(await types()).toEqual(['booking.confirmed', 'booking.cancelled']);
    });

    it('cancelar dos veces a la vez genera un único booking.cancelled', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await Promise.allSettled([bookings.cancel(players[0], b.id), bookings.cancel(owner, b.id)]);
      expect((await types()).filter((t) => t === 'booking.cancelled')).toHaveLength(1);
    });

    it('cancelar una reserva que nunca se pagó no genera eventos', async () => {
      const b = await newBooking();
      await bookings.cancel(players[0], b.id);
      expect(await types()).toEqual([]);
    });

    it('pagar y cancelar a la vez nunca deja el evento inconsistente con el estado final', async () => {
      for (let i = 0; i < 5; i++) {
        const b = await newBooking();
        await Promise.allSettled([payments.pay(players[0], b.id, 'tkn_test_ok'), bookings.cancel(players[0], b.id)]);
        const { status } = await ds.getRepository(Booking).findOneByOrFail({ id: b.id });
        const mine = (await events()).filter((e) => e.payload.bookingId === b.id).map((e) => e.type);
        // Quedó confirmada => solo "confirmed". Se canceló => nada (no llegó a pagar) o confirmed + cancelled.
        if (status === 'confirmed') expect(mine).toEqual(['booking.confirmed']);
        else expect([[], ['booking.confirmed', 'booking.cancelled']]).toContainEqual(mine);
      }
    });

    it('el evento es atómico: si la transacción se revierte, no queda ninguno', async () => {
      const b = await newBooking();
      await ds
        .transaction(async (m) => {
          await enqueueBookingEvent(m, 'booking.confirmed', b.id);
          throw new Error('falló algo después');
        })
        .catch(() => undefined);
      expect(await types()).toEqual([]);
    });
  });

  // Mismo ejemplo que verifica el chat-service (docs/contracts): si uno cambia sin el otro, falla un test.
  // En Docker la carpeta docs se monta en /docs; si no está disponible, el bloque se omite.
  const contractFile = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'booking-events.v1.example.json');
  (existsSync(contractFile) ? describe : describe.skip)('contrato con el chat-service', () => {
    const shape = (v: unknown): unknown =>
      v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).sort().map(([k, x]) => [k, shape(x)]))
        : typeof v;

    it('lo que se publica tiene exactamente la forma del ejemplo, en confirmed y en cancelled', async () => {
      const example = JSON.parse(readFileSync(contractFile, 'utf8'));
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await bookings.cancel(players[0], b.id);
      const publisher = new RecordingPublisher();
      await relay(publisher).flush();

      expect(publisher.sent).toHaveLength(2);
      for (const sent of publisher.sent) {
        const onTheWire = JSON.parse(JSON.stringify(sent)); // lo que llega realmente al bus
        expect(shape(onTheWire)).toEqual(shape(example));
      }
    });
  });

  describe('relevo hacia el bus', () => {
    it('publica en orden, con sobre completo, y marca como publicados', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await bookings.cancel(players[0], b.id);
      const publisher = new RecordingPublisher();

      expect(await relay(publisher).flush()).toBe(2);

      expect(publisher.sent.map((e) => e.type)).toEqual(['booking.confirmed', 'booking.cancelled']);
      const [first] = publisher.sent;
      expect(first).toMatchObject({ version: 1, data: { bookingId: b.id, playerId: players[0].id, ownerId: owner.id } });
      expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(first.occurredAt).getTime()).not.toBeNaN();
      expect((await events()).every((e) => e.publishedAt !== null)).toBe(true);
      expect(await relay(publisher).flush()).toBe(0); // nada que repetir
      expect(publisher.sent).toHaveLength(2);
    });

    it('si el bus falla, el evento sigue pendiente, se registra el error y se reintenta después', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      const publisher = new RecordingPublisher();
      publisher.failTimes = 2;

      expect(await relay(publisher).flush()).toBe(0);
      expect(await relay(publisher).flush()).toBe(0);
      const [pending] = await events();
      expect(pending.publishedAt).toBeNull();
      expect(pending.attempts).toBe(2);
      expect(pending.lastError).toContain('broker caído');

      expect(await relay(publisher).flush()).toBe(1);
      expect((await events())[0].publishedAt).not.toBeNull();
    });

    it('un fallo detiene el lote: un evento posterior nunca adelanta a uno que falló', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await bookings.cancel(players[0], b.id);
      const publisher = new RecordingPublisher();
      publisher.failTimes = 1;

      await relay(publisher).flush();
      expect(publisher.sent).toEqual([]); // el cancelled no se adelantó al confirmed

      await relay(publisher).flush();
      expect(publisher.sent.map((e) => e.type)).toEqual(['booking.confirmed', 'booking.cancelled']);
    });

    it('dos relevos simultáneos no publican el mismo evento dos veces', async () => {
      for (let i = 0; i < 6; i++) {
        const b = await newBooking();
        await payments.pay(players[0], b.id, 'tkn_test_ok');
      }
      const publisher = new RecordingPublisher();
      publisher.delayMs = 20;

      await Promise.all([relay(publisher).flush(), relay(publisher).flush(), relay(publisher).flush()]);

      const ids = publisher.sent.map((e) => e.eventId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(6);
    });

    it('sin bus configurado los eventos esperan en la bandeja, sin perderse', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      expect(await relay(new NoopEventPublisher()).flush()).toBe(0);
      expect((await events())[0].publishedAt).toBeNull();
      // Cuando por fin hay bus, se entregan.
      expect(await relay(new RecordingPublisher()).flush()).toBe(1);
    });
  });
});
