export enum PaymentStatus {
  // Se creó el intento y se está cobrando (o no sabemos aún el resultado).
  Processing = 'processing',
  Succeeded = 'succeeded',
  // La pasarela rechazó el cobro (tarjeta rechazada, fondos insuficientes...).
  Failed = 'failed',
  // Hay que devolver el dinero y la devolución está en curso.
  RefundPending = 'refund_pending',
  Refunded = 'refunded',
  // La devolución falló: requiere reintento (lo hace un admin) para no perder dinero del cliente.
  RefundFailed = 'refund_failed',
}
