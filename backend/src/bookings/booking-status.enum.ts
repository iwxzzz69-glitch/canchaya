export enum BookingStatus {
  // Horario bloqueado temporalmente mientras el jugador paga (expira solo).
  Pending = 'pending',
  Confirmed = 'confirmed',
  Cancelled = 'cancelled',
  // Un bloqueo temporal que venció sin confirmarse.
  Expired = 'expired',
}
