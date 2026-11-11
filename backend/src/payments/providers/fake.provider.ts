import {
  ChargeInfo,
  ChargeRequest,
  ChargeResult,
  PaymentGatewayUnavailableError,
  PaymentProvider,
  RefundRequest,
  RefundResult,
} from './payment-provider';

/**
 * Pasarela simulada para desarrollo y pruebas, sin cuentas ni red. El resultado depende del token:
 *   tkn_test_ok                          cobro aprobado (cualquier otro tkn_... también)
 *   tkn_test_insufficient_funds          rechazo por fondos insuficientes
 *   tkn_test_declined                    rechazo genérico
 *   tkn_test_unavailable                 la pasarela no responde y NO se cobra
 *   tkn_test_charged_then_unavailable    se cobra pero la respuesta se pierde (para probar el webhook)
 * El id del cargo es chr_test_fake_<payment_id>, así se puede simular un webhook conociendo el pago.
 * Nunca debe usarse en producción (PaymentsModule lo impide).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly charges = new Map<string, ChargeInfo>();
  readonly refunds: { id: string; chargeId: string; amountCents: number }[] = [];
  failNextRefund = false;
  /** Gancho de tests: se ejecuta tras crear el cargo y antes de responder (simula el paso del tiempo). */
  onChargeCreated?: (chargeId: string) => Promise<void>;
  private refundCounter = 0;

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const token = req.sourceId;
    if (token.includes('insufficient_funds')) {
      return { ok: false, code: 'insufficient_funds', userMessage: 'Fondos insuficientes.' };
    }
    if (token.includes('declined')) {
      return { ok: false, code: 'card_declined', userMessage: 'La tarjeta fue rechazada.' };
    }
    if (token.includes('tkn_test_unavailable')) {
      throw new PaymentGatewayUnavailableError('Pasarela simulada no disponible');
    }

    const chargeId = `chr_test_fake_${req.metadata.payment_id ?? this.charges.size + 1}`;
    this.charges.set(chargeId, {
      id: chargeId,
      paid: true,
      amountCents: req.amountCents,
      metadata: req.metadata,
    });
    if (this.onChargeCreated) await this.onChargeCreated(chargeId);
    if (token.includes('charged_then_unavailable')) {
      throw new PaymentGatewayUnavailableError('La respuesta de la pasarela simulada se perdió');
    }
    return { ok: true, chargeId };
  }

  async getCharge(chargeId: string): Promise<ChargeInfo | null> {
    return this.charges.get(chargeId) ?? null;
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    if (this.failNextRefund) {
      this.failNextRefund = false;
      return { ok: false, code: 'refund_rejected', message: 'Devolución rechazada (simulada)' };
    }
    if (!this.charges.has(req.chargeId)) {
      return { ok: false, code: 'charge_not_found', message: 'El cargo no existe' };
    }
    const id = `ref_test_fake_${++this.refundCounter}`;
    this.refunds.push({ id, chargeId: req.chargeId, amountCents: req.amountCents });
    return { ok: true, refundId: id };
  }
}
