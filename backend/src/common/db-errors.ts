// Códigos de error de PostgreSQL que la aplicación traduce a respuestas HTTP.
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_UNIQUE_VIOLATION = '23505';

export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { driverError?: { code?: string }; code?: string } | undefined;
  return e?.driverError?.code ?? e?.code;
}

/** Dos transacciones se esperaban entre sí; PostgreSQL abortó una. */
export const PG_DEADLOCK_DETECTED = '40P01';
