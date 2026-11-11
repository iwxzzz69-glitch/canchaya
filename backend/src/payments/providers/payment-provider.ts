// Contrato que cumple cualquier pasarela de pago (Culqi, Stripe, una simulada...).
// El resto de la aplicación solo conoce esta interfaz.

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface ChargeRequest {
  amountCents: number; // en céntimos: S/ 80.50 = 8050
  currency: 'PEN';
  email: string;
  sourceId: string; // token de tarjeta generado en el navegador (tkn_...), nunca datos de tarjeta
  description: string;
  metadata: Record<string, string>;
}

export type ChargeResult =
  | { ok: true; chargeId: string }
  // Rechazo claro de la pasarela: se sabe con certeza que NO se cobró.
  | { ok: false; code: string; userMessage: string };

export interface ChargeInfo {
  id: string;
  paid: boolean;
  amountCents: number;
  metadata: Record<string, string>;
}

export interface RefundRequest {
  chargeId: string;
  amountCents: number;
  reason: string;
}

export type RefundResult =
  | { ok: true; refundId: string }
  | { ok: false; code: string; message: string };

export interface PaymentProvider {
  readonly name: string;
  /** Lanza PaymentGatewayUnavailableError si no se puede saber el resultado (red, timeout, 5xx). */
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Consulta un cargo en la pasarela; null si no existe. */
  getCharge(chargeId: string): Promise<ChargeInfo | null>;
  refund(request: RefundRequest): Promise<RefundResult>;
}

/**
 * El resultado de la operación es desconocido: puede que el cobro sí se haya hecho.
 * Quien la reciba NO debe dar el pago por fallido; se concilia después (webhook).
 */
export class PaymentGatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentGatewayUnavailableError';
  }
}
