// Los locales operan en hora de Perú (America/Lima), UTC-5 todo el año (sin horario de verano).
// Las fechas se guardan en UTC (timestamptz); aquí se convierte de y hacia la hora local
// para validar horarios de atención y calcular los turnos de un día.
export const UTC_OFFSET_HOURS = -5;

const HOUR_MS = 3_600_000;

/** Instante UTC que corresponde a las `hour`:00 locales del día local y-m-d. */
export function localInstant(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - UTC_OFFSET_HOURS));
}

/** Hora local (0-23) de un instante. */
export function localHour(date: Date): number {
  return (date.getUTCHours() + UTC_OFFSET_HOURS + 24) % 24;
}

/** Fecha local "YYYY-MM-DD" de un instante. */
export function localDateString(date: Date): string {
  return new Date(date.getTime() + UTC_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
}

/** Convierte "YYYY-MM-DD" en sus partes; devuelve null si no es una fecha real (ej. 2026-02-31). */
export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const valid =
    check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return valid ? { year, month, day } : null;
}

/** ¿Empieza exactamente en una hora en punto? (los turnos son de horas completas) */
export function isOnTheHour(date: Date): boolean {
  return date.getTime() % HOUR_MS === 0;
}

export const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * HOUR_MS);
