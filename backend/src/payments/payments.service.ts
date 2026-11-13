import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { BookingStatus } from '../bookings/booking-status.enum';
import { Booking } from '../bookings/booking.entity';
import { PG_DEADLOCK_DETECTED, PG_UNIQUE_VIOLATION, pgErrorCode } from '../common/db-errors';
import { enqueueBookingEvent } from '../events/outbox';
import { PaymentStatus } from './payment-status.enum';
import { Payment } from './payment.entity';
import {
  PAYMENT_PROVIDER,
  PaymentGatewayUnavailableError,
  PaymentProvider,
} from './providers/payment-provider';

// Culqi no documenta los valores permitidos de `reason`; este es el que usa su propia guía de
// devoluciones. Si la pasarela lo rechazara, la devolución queda en refund_failed (nunca se pierde).
const REFUND_REASON = 'solicitud_comprador';
const DEFAULT_GRACE_SECONDS = 180;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const toCents = (amount: number) => Math.round(amount * 100);

export type RefundOutcome = 'none' | 'refunded' | 'failed';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly graceSeconds: number;
  private readonly webhookSecret?: string;

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    config: ConfigService,
  ) {
    const grace = Math.floor(Number(config.get('PAYMENT_GRACE_SECONDS')));
    this.graceSeconds = grace > 0 ? grace : DEFAULT_GRACE_SECONDS;
    this.webhookSecret = config.get<string>('CULQI_WEBHOOK_SECRET') || undefined;
  }

  /**
   * Cobra una reserva pendiente.
   *  1. En una transacción: alarga el bloqueo unos minutos (para que no venza a mitad del cobro) y
   *     crea el intento. El índice único parcial garantiza un solo intento vivo por reserva.
   *  2. Cobra en la pasarela con un token de tarjeta.
   *  3. Si cobró: en otra transacción marca el pago aprobado y confirma la reserva. Si la reserva
   *     ya no se puede confirmar (la cancelaron, la perdió), devuelve el dinero automáticamente.
   */
  async pay(user: AuthUser, bookingId: string, tokenId: string) {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.playerId !== user.id) throw new ForbiddenException('Esta reserva no es tuya');
    if (booking.status !== BookingStatus.Pending) {
      throw new ConflictException(`La reserva ya está ${booking.status}`);
    }

    const payment = await this.startAttempt(booking);

    let result;
    try {
      result = await this.provider.charge({
        amountCents: toCents(booking.totalPrice),
        currency: 'PEN',
        email: user.email,
        sourceId: tokenId,
        description: `CanchaYa reserva ${booking.id.slice(0, 8)}`,
        metadata: { booking_id: booking.id, payment_id: payment.id },
      });
    } catch (error) {
      if (error instanceof PaymentGatewayUnavailableError) {
        // No sabemos si cobró. El pago se queda en "processing": si el cobro sí ocurrió, el webhook
        // lo concilia y confirma la reserva. No se reintenta a ciegas para no cobrar dos veces.
        this.logger.error(`Resultado de cobro desconocido (pago ${payment.id}): ${error.message}`);
        throw new ServiceUnavailableException(
          'No pudimos confirmar el pago con la pasarela. Si el cobro se realizó, tu reserva se confirmará sola en unos minutos.',
        );
      }
      throw error;
    }

    if (!result.ok) {
      await this.payments.update(
        { id: payment.id, status: PaymentStatus.Processing },
        { status: PaymentStatus.Failed, failureCode: result.code, failureMessage: result.userMessage },
      );
      throw new HttpException(
        { statusCode: 402, error: 'Payment Required', message: result.userMessage, code: result.code },
        402,
      );
    }

    const { outcome } = await this.finalizeSuccessfulCharge(payment.id, result.chargeId);
    if (outcome === 'refunded') {
      throw new ConflictException('Tu reserva ya no estaba disponible, así que te devolvimos el pago.');
    }
    if (outcome === 'refund_failed') {
      throw new ConflictException(
        'Tu reserva ya no estaba disponible y la devolución automática falló; el equipo te devolverá el dinero.',
      );
    }
    return this.describe(booking.id, payment.id);
  }

  private startAttempt(booking: Booking): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      // Primero se bloquea la fila de la reserva: los intentos simultáneos (doble clic) hacen fila
      // en vez de pelearse por los bloqueos de la actualización y del índice único (deadlock).
      await manager.findOne(Booking, { where: { id: booking.id }, lock: { mode: 'pessimistic_write' } });
      const extended = await manager
        .createQueryBuilder()
        .update(Booking)
        .set({ expiresAt: () => `GREATEST(expires_at, now() + interval '${this.graceSeconds} seconds')` })
        .where('id = :id', { id: booking.id })
        .andWhere('status = :pending', { pending: BookingStatus.Pending })
        .andWhere('expires_at > now()')
        .execute();
      if (!extended.affected) {
        throw new ConflictException('La reserva ya no está pendiente o su bloqueo venció');
      }
      try {
        return await manager.save(
          manager.create(Payment, {
            bookingId: booking.id,
            amount: booking.totalPrice,
            currency: 'PEN',
            provider: this.provider.name,
            status: PaymentStatus.Processing,
          }),
        );
      } catch (error) {
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION || pgErrorCode(error) === PG_DEADLOCK_DETECTED) {
          throw new ConflictException('Ya hay un pago en curso o realizado para esta reserva');
        }
        throw error;
      }
    });
  }

  /**
   * Punto único para dar un cobro por bueno (lo usan el flujo normal y el webhook): marca el pago
   * como aprobado y confirma la reserva en la misma transacción. Es idempotente: si el pago ya no
   * está en "processing" (otro camino ya lo procesó) no hace nada.
   */
  async finalizeSuccessfulCharge(
    paymentId: string,
    chargeId: string,
  ): Promise<{ outcome: 'confirmed' | 'noop' | 'refunded' | 'refund_failed' }> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      // Mismo orden de bloqueos que startAttempt (primero la reserva, luego el pago); si no, un
      // intento concurrente que ya tiene la reserva y espera al pago provocaría un deadlock.
      const current = await manager.findOne(Payment, { where: { id: paymentId } });
      if (!current) return 'noop' as const;
      await manager.findOne(Booking, { where: { id: current.bookingId }, lock: { mode: 'pessimistic_write' } });
      const approved = await manager
        .createQueryBuilder()
        .update(Payment)
        .set({ status: PaymentStatus.Succeeded, providerChargeId: chargeId })
        .where('id = :paymentId', { paymentId })
        .andWhere('status = :processing', { processing: PaymentStatus.Processing })
        .execute();
      if (!approved.affected) return 'noop' as const;

      const payment = await manager.findOneOrFail(Payment, { where: { id: paymentId } });
      const confirmed = await manager
        .createQueryBuilder()
        .update(Booking)
        .set({ status: BookingStatus.Confirmed, expiresAt: null })
        .where('id = :bookingId', { bookingId: payment.bookingId })
        .andWhere('status = :pending', { pending: BookingStatus.Pending })
        .execute();
      if (confirmed.affected) {
        // El aviso para el chat sale en la misma transacción: o se confirma y se anuncia, o ninguna.
        await enqueueBookingEvent(manager, 'booking.confirmed', payment.bookingId);
        return 'confirmed' as const;
      }

      // Se cobró pero la reserva ya no existe como pendiente: hay que devolver el dinero.
      await manager.update(Payment, { id: paymentId }, { status: PaymentStatus.RefundPending });
      return 'refund' as const;
    });

    if (outcome === 'refund') {
      const refund = await this.refundPayment(paymentId);
      return { outcome: refund === 'refunded' ? 'refunded' : 'refund_failed' };
    }
    return { outcome };
  }

  // Devuelve el dinero de un pago que está en refund_pending. Nunca lanza: deja el estado final.
  private async refundPayment(paymentId: string): Promise<'refunded' | 'refund_failed'> {
    const payment = await this.payments.findOneOrFail({ where: { id: paymentId } });
    try {
      const result = await this.provider.refund({
        chargeId: payment.providerChargeId as string,
        amountCents: toCents(payment.amount),
        reason: REFUND_REASON,
      });
      if (result.ok) {
        await this.payments.update(paymentId, { status: PaymentStatus.Refunded, refundId: result.refundId });
        return 'refunded';
      }
      this.logger.error(`Devolución rechazada del pago ${paymentId}: ${result.code} ${result.message}`);
      await this.payments.update(paymentId, {
        status: PaymentStatus.RefundFailed,
        failureCode: result.code,
        failureMessage: result.message,
      });
    } catch (error) {
      this.logger.error(`Devolución sin respuesta del pago ${paymentId}: ${(error as Error).message}`);
      await this.payments.update(paymentId, {
        status: PaymentStatus.RefundFailed,
        failureCode: 'gateway_unavailable',
        failureMessage: 'La pasarela no respondió a la devolución',
      });
    }
    return 'refund_failed';
  }

  /** Al cancelar una reserva pagada: devuelve el dinero completo. Nunca lanza. */
  async refundForBooking(bookingId: string): Promise<RefundOutcome> {
    const claimed = await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({ status: PaymentStatus.RefundPending })
      .where('booking_id = :bookingId', { bookingId })
      .andWhere('status = :succeeded', { succeeded: PaymentStatus.Succeeded })
      .execute();
    if (!claimed.affected) return 'none';

    const payment = await this.payments.findOneOrFail({
      where: { bookingId, status: PaymentStatus.RefundPending },
    });
    return (await this.refundPayment(payment.id)) === 'refunded' ? 'refunded' : 'failed';
  }

  /** Reintento manual (admin) de una devolución que falló. */
  async retryRefund(paymentId: string) {
    const claimed = await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({ status: PaymentStatus.RefundPending })
      .where('id = :paymentId', { paymentId })
      .andWhere('status = :failed', { failed: PaymentStatus.RefundFailed })
      .execute();
    if (!claimed.affected) {
      throw new ConflictException('Este pago no tiene una devolución fallida que reintentar');
    }
    return { status: await this.refundPayment(paymentId) };
  }

  /**
   * Webhook de Culqi. La documentación de Culqi no describe una firma para verificarlo, así que:
   *  - la URL lleva un secreto (CULQI_WEBHOOK_SECRET) que se compara en tiempo constante, y
   *  - el contenido del evento NO se cree: solo se usa el id del cargo, que se vuelve a consultar
   *    a Culqi con la llave secreta; lo que decide es la respuesta de la API, no el POST recibido.
   */
  async handleWebhook(secret: string, body: unknown) {
    if (!this.webhookSecret) throw new NotFoundException();
    if (!timingSafeEqual(sha256(secret), sha256(this.webhookSecret))) throw new UnauthorizedException();

    const event = body as { type?: unknown; data?: unknown } | undefined;
    if (event?.type !== 'charge.creation.succeeded') return { received: true };

    let data = event.data as { id?: unknown } | string | undefined;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return { received: true };
      }
    }
    const chargeId = (data as { id?: unknown } | undefined)?.id;
    if (typeof chargeId !== 'string') return { received: true };

    let charge;
    try {
      charge = await this.provider.getCharge(chargeId);
    } catch {
      // Pedimos que reintenten el aviso más tarde.
      throw new ServiceUnavailableException();
    }
    const paymentId = charge?.metadata?.payment_id;
    if (!charge || !charge.paid || !paymentId || !UUID.test(paymentId)) return { received: true };

    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment || payment.status !== PaymentStatus.Processing) return { received: true };
    if (charge.amountCents !== toCents(payment.amount)) {
      this.logger.warn(`El monto del cargo ${charge.id} no coincide con el del pago ${payment.id}`);
      return { received: true };
    }

    await this.finalizeSuccessfulCharge(payment.id, charge.id);
    return { received: true };
  }

  private async describe(bookingId: string, paymentId: string) {
    const [booking, payment] = await Promise.all([
      this.bookings.findOneOrFail({ where: { id: bookingId } }),
      this.payments.findOneOrFail({ where: { id: paymentId } }),
    ]);
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        totalPrice: booking.totalPrice,
      },
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
      },
    };
  }

  async listMine(user: AuthUser) {
    const rows = await this.payments.find({
      where: { booking: { playerId: user.id } },
      relations: { booking: { court: { venue: true } } },
      order: { createdAt: 'DESC' },
    });
    return rows.map((p) => ({
      id: p.id,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      createdAt: p.createdAt,
      failureMessage: p.failureMessage,
      booking: {
        id: p.booking.id,
        status: p.booking.status,
        startsAt: p.booking.startsAt,
        court: p.booking.court.name,
        venue: p.booking.court.venue.name,
      },
    }));
  }
}
