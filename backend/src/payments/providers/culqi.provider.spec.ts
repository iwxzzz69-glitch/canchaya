import { CulqiProvider } from './culqi.provider';
import { PaymentGatewayUnavailableError } from './payment-provider';

const SECRET = 'sk_test_SUPERSECRETO';

function reply(status: number, body?: unknown, rawText?: string) {
  return jest.fn(async () => new Response(rawText ?? (body === undefined ? '' : JSON.stringify(body)), { status }));
}

function provider(fetchImpl: typeof fetch) {
  return new CulqiProvider({ secretKey: SECRET, fetchImpl });
}

const chargeReq = {
  amountCents: 8050,
  currency: 'PEN' as const,
  email: 'a@b.com',
  sourceId: 'tkn_test_abc',
  description: 'x'.repeat(200),
  metadata: { payment_id: 'p1' },
};

describe('CulqiProvider', () => {
  describe('charge', () => {
    it('envía la petición con el formato de Culqi y devuelve el id del cargo', async () => {
      const fetchMock = reply(201, { id: 'chr_test_1' });
      const result = await provider(fetchMock as unknown as typeof fetch).charge(chargeReq);

      expect(result).toEqual({ ok: true, chargeId: 'chr_test_1' });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.culqi.com/v2/charges');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({
        amount: 8050,
        currency_code: 'PEN',
        email: 'a@b.com',
        source_id: 'tkn_test_abc',
        metadata: { payment_id: 'p1' },
      });
      expect(body.description).toHaveLength(80); // Culqi limita la descripción
      expect(JSON.stringify(body)).not.toContain(SECRET); // la llave va en el header, nunca en el cuerpo
    });

    it('respeta una URL base personalizada', async () => {
      const fetchMock = reply(201, { id: 'chr_1' });
      await new CulqiProvider({
        secretKey: SECRET,
        baseUrl: 'https://sandbox.example.com/v2/',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }).charge(chargeReq);
      expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://sandbox.example.com/v2/charges');
    });

    it('un rechazo 4xx es un fallo claro con el mensaje para el usuario', async () => {
      const result = await provider(
        reply(402, { code: 'card_declined', user_message: 'Tarjeta rechazada' }) as unknown as typeof fetch,
      ).charge(chargeReq);
      expect(result).toEqual({ ok: false, code: 'card_declined', userMessage: 'Tarjeta rechazada' });
    });

    it('un 4xx sin cuerpo usa un mensaje genérico', async () => {
      const result = await provider(reply(400) as unknown as typeof fetch).charge(chargeReq);
      expect(result).toMatchObject({ ok: false, code: 'payment_declined' });
    });

    it('llave inválida (401) no culpa al cliente ni revela detalles', async () => {
      const result = await provider(
        reply(401, { merchant_message: `llave ${SECRET} inválida` }) as unknown as typeof fetch,
      ).charge(chargeReq);
      expect(result).toMatchObject({ ok: false, code: 'gateway_credentials' });
      expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    it('un 5xx significa resultado desconocido, no un rechazo', async () => {
      await expect(provider(reply(503) as unknown as typeof fetch).charge(chargeReq)).rejects.toBeInstanceOf(
        PaymentGatewayUnavailableError,
      );
    });

    it('un fallo de red o timeout significa resultado desconocido y no filtra la llave', async () => {
      const failing = jest.fn(async () => {
        throw new Error(`ECONNRESET con ${SECRET}`);
      });
      const error = await provider(failing as unknown as typeof fetch)
        .charge(chargeReq)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentGatewayUnavailableError);
      expect((error as Error).message).not.toContain(SECRET);
    });

    it('un 200 sin id no se acepta como cobro exitoso', async () => {
      const result = await provider(reply(200, {}) as unknown as typeof fetch).charge(chargeReq);
      expect(result.ok).toBe(false);
    });
  });

  describe('getCharge', () => {
    it.each([
      ['outcome.type', { outcome: { type: 'venta_exitosa' } }],
      ['response_code', { response_code: 'venta_exitosa' }],
      ['state', { state: 'exitosa' }],
    ])('detecta un cargo pagado por %s', async (_name, extra) => {
      const info = await provider(
        reply(200, { id: 'chr_1', amount: 8050, metadata: { payment_id: 'p1' }, ...extra }) as unknown as typeof fetch,
      ).getCharge('chr_1');
      expect(info).toEqual({ id: 'chr_1', paid: true, amountCents: 8050, metadata: { payment_id: 'p1' } });
    });

    it('un cargo sin señal de éxito no se considera pagado', async () => {
      const info = await provider(
        reply(200, { id: 'chr_1', amount: 8050, outcome: { type: 'rechazada' } }) as unknown as typeof fetch,
      ).getCharge('chr_1');
      expect(info?.paid).toBe(false);
      expect(info?.metadata).toEqual({});
    });

    it('404 devuelve null', async () => {
      expect(await provider(reply(404, {}) as unknown as typeof fetch).getCharge('chr_x')).toBeNull();
    });

    it('otros errores se tratan como pasarela no disponible', async () => {
      await expect(provider(reply(401, {}) as unknown as typeof fetch).getCharge('chr_x')).rejects.toBeInstanceOf(
        PaymentGatewayUnavailableError,
      );
    });

    it('escapa el id en la URL', async () => {
      const fetchMock = reply(404, {});
      await provider(fetchMock as unknown as typeof fetch).getCharge('../refunds');
      expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
        'https://api.culqi.com/v2/charges/..%2Frefunds',
      );
    });
  });

  describe('refund', () => {
    it('envía charge_id, amount y reason', async () => {
      const fetchMock = reply(201, { id: 'ref_1' });
      const result = await provider(fetchMock as unknown as typeof fetch).refund({
        chargeId: 'chr_1',
        amountCents: 8050,
        reason: 'solicitud_comprador',
      });
      expect(result).toEqual({ ok: true, refundId: 'ref_1' });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.culqi.com/v2/refunds');
      expect(JSON.parse(init.body as string)).toEqual({
        amount: 8050,
        charge_id: 'chr_1',
        reason: 'solicitud_comprador',
      });
    });

    it('un rechazo devuelve el motivo', async () => {
      const result = await provider(
        reply(400, { code: 'already_refunded', merchant_message: 'Ya devuelto' }) as unknown as typeof fetch,
      ).refund({ chargeId: 'chr_1', amountCents: 100, reason: 'x' });
      expect(result).toEqual({ ok: false, code: 'already_refunded', message: 'Ya devuelto' });
    });

    it('un 5xx es pasarela no disponible', async () => {
      await expect(
        provider(reply(500) as unknown as typeof fetch).refund({ chargeId: 'c', amountCents: 1, reason: 'x' }),
      ).rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
    });
  });
});
