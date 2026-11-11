import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { BookingStatus } from '../bookings/booking-status.enum';
import { Booking } from '../bookings/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import {
  createTestDatabase,
  destroyTestDatabase,
  hasDatabase,
  seedBasics,
  slot,
} from '../testing/test-database';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { PaymentStatus } from './payment-status.enum';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';
import { FakePaymentProvider } from './providers/fake.provider';

/**
 * Flujo de cobro completo contra PostgreSQL real y la pasarela simulada.
 * Usa su propia base `canchaya_test_payments`; sin DATABASE_URL se omite.
 */
const describeDb = hasDatabase ? describe : describe.skip;
const DB = 'canchaya_test_payments';
const WEBHOOK_SECRET = 'secreto-de-prueba';

describeDb('Pagos (PostgreSQL real + pasarela simulada)', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let provider: FakePaymentProvider;
  let payments: PaymentsService;
  let bookings: BookingsService;
  let courtId: string;
  let players: AuthUser[];
  let hour: number;

  beforeAll(async () => {
    ds = await createTestDatabase(DB);
    const seed = await seedBasics(ds, 4);
    courtId = seed.courtId;
    players = seed.players;
  });

  afterAll(() => destroyTestDatabase(ds, DB));

  beforeEach(async () => {
    await ds.query('TRUNCATE payments, bookings CASCADE');
    provider = new FakePaymentProvider();
    const config = new ConfigService({
      CULQI_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PAYMENT_GRACE_SECONDS: 180,
      BOOKING_HOLD_MINUTES: 10,
    });
    payments = new PaymentsService(
      ds.getRepository(Payment),
      ds.getRepository(Booking),
      ds,
      provider,
      config,
    );
    bookings = new BookingsService(
      ds.getRepository(Booking),
      ds.getRepository(Court),
      ds.getRepository(Venue),
      payments,
      config,
    );
    hour = 8;
  });

  const newBooking = async (player = players[0]) => bookings.create(player, { courtId, startsAt: slot(hour++) });
  const bookingRow = async (id: string) => (await ds.getRepository(Booking).findOneByOrFail({ id }));
  const paymentRows = (bookingId: string) => ds.getRepository(Payment).find({ where: { bookingId } });
  const statusOf = async (bookingId: string) => (await bookingRow(bookingId)).status;

  const failure = async (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

  describe('cobro exitoso', () => {
    it('cobra el monto exacto, confirma la reserva y quita el vencimiento', async () => {
      const b = await newBooking();
      const result = await payments.pay(players[0], b.id, 'tkn_test_ok');

      expect(result.booking.status).toBe(BookingStatus.Confirmed);
      expect(result.payment.status).toBe(PaymentStatus.Succeeded);
      const row = await bookingRow(b.id);
      expect(row.status).toBe(BookingStatus.Confirmed);
      expect(row.expiresAt).toBeNull();
      const charges = [...provider.charges.values()];
      expect(charges).toHaveLength(1);
      expect(charges[0].amountCents).toBe(8000); // S/ 80.00
      expect(charges[0].metadata.booking_id).toBe(b.id);
    });

    it('el token de tarjeta nunca se guarda en la base de datos', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      const dump = JSON.stringify(await ds.query('SELECT * FROM payments'));
      expect(dump).not.toContain('tkn_test_ok');
    });
  });

  describe('doble clic y concurrencia', () => {
    it('10 pagos simultáneos de la misma reserva cobran una sola vez', async () => {
      const b = await newBooking();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => payments.pay(players[0], b.id, 'tkn_test_ok')),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
      }
      expect(provider.charges.size).toBe(1);
      const rows = await paymentRows(b.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(PaymentStatus.Succeeded);
      expect(await statusOf(b.id)).toBe(BookingStatus.Confirmed);
    });

    it('pagar una reserva ya pagada responde 409 y no cobra de nuevo', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await expect(payments.pay(players[0], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ConflictException);
      expect(provider.charges.size).toBe(1);
    });
  });

  describe('permisos y reglas previas', () => {
    it('no se puede pagar la reserva de otro jugador', async () => {
      const b = await newBooking(players[0]);
      await expect(payments.pay(players[1], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ForbiddenException);
      expect(provider.charges.size).toBe(0);
    });

    it('una reserva inexistente responde 404', async () => {
      await expect(
        payments.pay(players[0], '00000000-0000-4000-8000-000000000000', 'tkn_test_ok'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si el bloqueo ya venció responde 409 sin cobrar', async () => {
      const b = await newBooking();
      await ds.query(`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`, [b.id]);
      await expect(payments.pay(players[0], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ConflictException);
      expect(provider.charges.size).toBe(0);
      expect(await paymentRows(b.id)).toHaveLength(0);
    });

    it('una reserva cancelada no se puede pagar', async () => {
      const b = await newBooking();
      await bookings.cancel(players[0], b.id);
      await expect(payments.pay(players[0], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ConflictException);
      expect(provider.charges.size).toBe(0);
    });

    it('antes de cobrar alarga el bloqueo para que no venza a mitad del cobro', async () => {
      const b = await newBooking();
      await ds.query(`UPDATE bookings SET expires_at = now() + interval '5 seconds' WHERE id = $1`, [b.id]);
      let expiresDuringCharge: Date | undefined;
      provider.onChargeCreated = async () => {
        expiresDuringCharge = (await bookingRow(b.id)).expiresAt ?? undefined;
      };
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      expect((expiresDuringCharge as Date).getTime() - Date.now()).toBeGreaterThan(120_000);
    });
  });

  describe('rechazos de la pasarela', () => {
    it.each([
      ['tkn_test_declined', 'card_declined'],
      ['tkn_test_insufficient_funds', 'insufficient_funds'],
    ])('%s responde 402, deja la reserva pendiente y permite reintentar', async (token, code) => {
      const b = await newBooking();
      const error = (await failure(payments.pay(players[0], b.id, token))) as HttpException;
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(402);
      expect((error.getResponse() as { code: string }).code).toBe(code);

      expect(await statusOf(b.id)).toBe(BookingStatus.Pending);
      expect((await paymentRows(b.id))[0].status).toBe(PaymentStatus.Failed);

      // El jugador prueba con otra tarjeta: el intento fallido no estorba.
      const retry = await payments.pay(players[0], b.id, 'tkn_test_ok');
      expect(retry.booking.status).toBe(BookingStatus.Confirmed);
      expect(await paymentRows(b.id)).toHaveLength(2);
    });
  });

  describe('pasarela caída', () => {
    it('sin cobro: responde 503 y el pago queda en processing, la reserva sigue pendiente', async () => {
      const b = await newBooking();
      await expect(payments.pay(players[0], b.id, 'tkn_test_unavailable')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(await statusOf(b.id)).toBe(BookingStatus.Pending);
      expect((await paymentRows(b.id))[0].status).toBe(PaymentStatus.Processing);
      // Mientras haya un intento sin resolver no se permite otro (podría cobrar doble).
      await expect(payments.pay(players[0], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ConflictException);
      expect(provider.charges.size).toBe(0);
    });

    it('cobró pero se perdió la respuesta: el webhook concilia y confirma la reserva', async () => {
      const b = await newBooking();
      await expect(payments.pay(players[0], b.id, 'tkn_test_charged_then_unavailable')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(await statusOf(b.id)).toBe(BookingStatus.Pending);
      const [chargeId] = [...provider.charges.keys()];

      await payments.handleWebhook(WEBHOOK_SECRET, {
        type: 'charge.creation.succeeded',
        data: JSON.stringify({ id: chargeId }), // Culqi envía `data` como texto JSON
      });

      expect(await statusOf(b.id)).toBe(BookingStatus.Confirmed);
      const [payment] = await paymentRows(b.id);
      expect(payment.status).toBe(PaymentStatus.Succeeded);
      expect(payment.providerChargeId).toBe(chargeId);
    });

    it('el webhook repetido no confirma ni cobra dos veces (idempotente)', async () => {
      const b = await newBooking();
      await failure(payments.pay(players[0], b.id, 'tkn_test_charged_then_unavailable'));
      const [chargeId] = [...provider.charges.keys()];
      const event = { type: 'charge.creation.succeeded', data: { id: chargeId } };

      await Promise.all([payments.handleWebhook(WEBHOOK_SECRET, event), payments.handleWebhook(WEBHOOK_SECRET, event)]);
      await payments.handleWebhook(WEBHOOK_SECRET, event);

      expect(await statusOf(b.id)).toBe(BookingStatus.Confirmed);
      expect(await paymentRows(b.id)).toHaveLength(1);
      expect(provider.refunds).toHaveLength(0);
    });
  });

  describe('webhook: seguridad', () => {
    it('rechaza un secreto incorrecto', async () => {
      await expect(payments.handleWebhook('otro', { type: 'charge.creation.succeeded' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('si no hay secreto configurado, el endpoint no existe', async () => {
      const bare = new PaymentsService(
        ds.getRepository(Payment),
        ds.getRepository(Booking),
        ds,
        provider,
        new ConfigService({}),
      );
      await expect(bare.handleWebhook('', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ignora eventos de otro tipo y cuerpos raros sin fallar', async () => {
      for (const body of [undefined, null, {}, { type: 'order.paid' }, { type: 'charge.creation.succeeded' },
        { type: 'charge.creation.succeeded', data: 'no es json' }, { type: 'charge.creation.succeeded', data: { id: 5 } }]) {
        await expect(payments.handleWebhook(WEBHOOK_SECRET, body)).resolves.toEqual({ received: true });
      }
    });

    it('no cree lo que dice el POST: un cargo inexistente en la pasarela no confirma nada', async () => {
      const b = await newBooking();
      await failure(payments.pay(players[0], b.id, 'tkn_test_unavailable')); // pago en processing, sin cargo
      const [payment] = await paymentRows(b.id);

      await payments.handleWebhook(WEBHOOK_SECRET, {
        type: 'charge.creation.succeeded',
        data: { id: 'chr_inventado', metadata: { payment_id: payment.id }, paid: true },
      });

      expect(await statusOf(b.id)).toBe(BookingStatus.Pending);
    });

    it('un cargo con monto distinto al del pago no confirma la reserva', async () => {
      const b = await newBooking();
      await failure(payments.pay(players[0], b.id, 'tkn_test_unavailable'));
      const [payment] = await paymentRows(b.id);
      provider.charges.set('chr_barato', { id: 'chr_barato', paid: true, amountCents: 100, metadata: { payment_id: payment.id } });

      await payments.handleWebhook(WEBHOOK_SECRET, { type: 'charge.creation.succeeded', data: { id: 'chr_barato' } });

      expect(await statusOf(b.id)).toBe(BookingStatus.Pending);
      expect((await paymentRows(b.id))[0].status).toBe(PaymentStatus.Processing);
    });

    it('un cargo sin pagar o con payment_id inválido se ignora', async () => {
      provider.charges.set('chr_a', { id: 'chr_a', paid: false, amountCents: 8000, metadata: { payment_id: 'x' } });
      provider.charges.set('chr_b', { id: 'chr_b', paid: true, amountCents: 8000, metadata: { payment_id: "'; DROP TABLE payments;--" } });
      for (const id of ['chr_a', 'chr_b']) {
        await expect(
          payments.handleWebhook(WEBHOOK_SECRET, { type: 'charge.creation.succeeded', data: { id } }),
        ).resolves.toEqual({ received: true });
      }
    });
  });

  describe('devolución automática', () => {
    it('si se cobró pero la reserva se canceló durante el cobro, se devuelve el dinero', async () => {
      const b = await newBooking();
      // Mientras la pasarela procesa, el dueño cancela la reserva.
      provider.onChargeCreated = async () => {
        await ds.query(`UPDATE bookings SET status = 'cancelled', expires_at = NULL WHERE id = $1`, [b.id]);
      };

      await expect(payments.pay(players[0], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ConflictException);

      const [payment] = await paymentRows(b.id);
      expect(payment.status).toBe(PaymentStatus.Refunded);
      expect(payment.refundId).toBeTruthy();
      expect(provider.refunds).toEqual([expect.objectContaining({ amountCents: 8000 })]);
      expect(await statusOf(b.id)).toBe(BookingStatus.Cancelled);
    });

    it('si además la devolución falla, queda refund_failed y un admin puede reintentarla', async () => {
      const b = await newBooking();
      provider.onChargeCreated = async () => {
        await ds.query(`UPDATE bookings SET status = 'cancelled', expires_at = NULL WHERE id = $1`, [b.id]);
      };
      provider.failNextRefund = true;

      await expect(payments.pay(players[0], b.id, 'tkn_test_ok')).rejects.toBeInstanceOf(ConflictException);
      const [failed] = await paymentRows(b.id);
      expect(failed.status).toBe(PaymentStatus.RefundFailed);
      expect(failed.failureCode).toBe('refund_rejected');

      await expect(payments.retryRefund(failed.id)).resolves.toEqual({ status: 'refunded' });
      expect((await paymentRows(b.id))[0].status).toBe(PaymentStatus.Refunded);
      expect(provider.refunds).toHaveLength(1);

      // Reintentar algo ya devuelto no devuelve el dinero otra vez.
      await expect(payments.retryRefund(failed.id)).rejects.toBeInstanceOf(ConflictException);
      expect(provider.refunds).toHaveLength(1);
    });
  });

  describe('cancelar una reserva pagada', () => {
    it('devuelve el dinero, libera el horario e informa el reembolso', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');

      const cancelled = await bookings.cancel(players[0], b.id);

      expect(cancelled.status).toBe(BookingStatus.Cancelled);
      expect(cancelled.refund).toBe('refunded');
      expect((await paymentRows(b.id))[0].status).toBe(PaymentStatus.Refunded);
      expect(provider.refunds).toHaveLength(1);
      // El horario vuelve a estar libre.
      await expect(bookings.create(players[1], { courtId, startsAt: b.startsAt.toISOString() })).resolves.toBeDefined();
    });

    it('cancelar dos veces no devuelve el dinero dos veces', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      await Promise.allSettled([bookings.cancel(players[0], b.id), bookings.cancel(players[0], b.id)]);
      expect(provider.refunds).toHaveLength(1);
    });

    it('si la devolución falla, la reserva queda cancelada y se informa refund = failed', async () => {
      const b = await newBooking();
      await payments.pay(players[0], b.id, 'tkn_test_ok');
      provider.failNextRefund = true;

      const cancelled = await bookings.cancel(players[0], b.id);

      expect(cancelled.status).toBe(BookingStatus.Cancelled);
      expect(cancelled.refund).toBe('failed');
      expect((await paymentRows(b.id))[0].status).toBe(PaymentStatus.RefundFailed);
    });

    it('cancelar una reserva sin pagar no genera reembolso', async () => {
      const b = await newBooking();
      expect((await bookings.cancel(players[0], b.id)).refund).toBe('none');
      expect(provider.refunds).toHaveLength(0);
    });
  });

  describe('integridad en la base de datos', () => {
    it('el índice parcial impide dos pagos vivos para la misma reserva aunque se salte el servicio', async () => {
      const b = await newBooking();
      const insert = () =>
        ds.query(
          `INSERT INTO payments (booking_id, amount, currency, provider, status) VALUES ($1, 80, 'PEN', 'x', 'processing')`,
          [b.id],
        );
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23505' });
    });

    it('permite varios pagos fallidos pero no borrar una reserva con pagos', async () => {
      const b = await newBooking();
      await failure(payments.pay(players[0], b.id, 'tkn_test_declined'));
      await failure(payments.pay(players[0], b.id, 'tkn_test_declined'));
      expect(await paymentRows(b.id)).toHaveLength(2);
      await expect(ds.query('DELETE FROM bookings WHERE id = $1', [b.id])).rejects.toMatchObject({ code: '23503' });
    });
  });

  describe('historial', () => {
    it('payments/mine lista solo los pagos del usuario con el detalle de la reserva', async () => {
      const mine = await newBooking(players[0]);
      const theirs = await newBooking(players[1]);
      await payments.pay(players[0], mine.id, 'tkn_test_ok');
      await payments.pay(players[1], theirs.id, 'tkn_test_ok');

      const list = await payments.listMine(players[0]);

      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ status: 'succeeded', booking: { id: mine.id, court: 'Cancha 1', venue: 'Local' } });
    });
  });
});
