import {
  ChargeInfo,
  ChargeRequest,
  ChargeResult,
  PaymentGatewayUnavailableError,
  PaymentProvider,
  RefundRequest,
  RefundResult,
} from './payment-provider';

export interface CulqiOptions {
  /** Llave secreta (sk_test_... en integración, sk_live_... en producción). Nunca va al navegador. */
  secretKey: string;
  /** Por defecto https://api.culqi.com/v2 */
  baseUrl?: string;
  timeoutMs?: number;
  /** Solo para tests. */
  fetchImpl?: typeof fetch;
}

interface CulqiResponse {
  status: number;
  json: Record<string, any>;
}

/**
 * Cliente de la API v2 de Culqi (https://docs.culqi.com).
 *
 * Qué se confirmó en su documentación: POST /charges con Bearer sk_..., campos amount (céntimos),
 * currency_code, email, source_id, description (máx. 80) y metadata; éxito 201, rechazos 4xx con
 * user_message; POST /refunds con amount, charge_id y reason.
 * Qué NO: los valores permitidos de `reason` y qué campo marca un cargo como pagado (la
 * documentación menciona outcome, response_code y state), por eso getCharge acepta los tres.
 */
export class CulqiProvider implements PaymentProvider {
  readonly name = 'culqi';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CulqiOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.culqi.com/v2').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(method: string, path: string, body?: unknown): Promise<CulqiResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Sin respuesta (red caída, timeout): no se sabe si Culqi llegó a procesar la operación.
      // El mensaje no incluye la llave ni el cuerpo de la petición.
      throw new PaymentGatewayUnavailableError(`Culqi no respondió (${method} ${path})`);
    }

    const text = await response.text();
    let json: Record<string, any> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // Cuerpo no JSON: se trata según el código HTTP.
    }
    if (response.status >= 500) {
      throw new PaymentGatewayUnavailableError(`Culqi respondió ${response.status} (${method} ${path})`);
    }
    return { status: response.status, json };
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const { status, json } = await this.request('POST', '/charges', {
      amount: req.amountCents,
      currency_code: req.currency,
      email: req.email,
      source_id: req.sourceId,
      description: req.description.slice(0, 80),
      metadata: req.metadata,
    });

    if ((status === 200 || status === 201) && typeof json.id === 'string') {
      return { ok: true, chargeId: json.id };
    }
    if (status === 401 || status === 403) {
      // Llave secreta inválida: es un problema de configuración nuestro, no del cliente.
      return {
        ok: false,
        code: 'gateway_credentials',
        userMessage: 'No pudimos procesar el pago en este momento. Inténtalo más tarde.',
      };
    }
    return {
      ok: false,
      code: String(json.code ?? json.type ?? 'payment_declined'),
      userMessage: String(json.user_message ?? 'El pago fue rechazado. Prueba con otra tarjeta.'),
    };
  }

  async getCharge(chargeId: string): Promise<ChargeInfo | null> {
    const { status, json } = await this.request('GET', `/charges/${encodeURIComponent(chargeId)}`);
    if (status === 404) return null;
    if (status !== 200 || typeof json.id !== 'string') {
      throw new PaymentGatewayUnavailableError(`Culqi respondió ${status} al consultar un cargo`);
    }
    const paid =
      json.outcome?.type === 'venta_exitosa' ||
      json.response_code === 'venta_exitosa' ||
      String(json.state ?? '').toLowerCase() === 'exitosa';
    return {
      id: json.id,
      paid,
      amountCents: Number(json.amount),
      metadata: (json.metadata ?? {}) as Record<string, string>,
    };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const { status, json } = await this.request('POST', '/refunds', {
      amount: req.amountCents,
      charge_id: req.chargeId,
      reason: req.reason,
    });
    if ((status === 200 || status === 201) && typeof json.id === 'string') {
      return { ok: true, refundId: json.id };
    }
    return {
      ok: false,
      code: String(json.code ?? json.type ?? `http_${status}`),
      message: String(json.merchant_message ?? json.user_message ?? 'La devolución fue rechazada'),
    };
  }
}
