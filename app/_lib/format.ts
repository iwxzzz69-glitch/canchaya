import type { Level, Sport } from './types';

const TZ = 'America/Lima';
const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const formatMoney = (n: number | string) => money.format(Number(n)).replace(/\s/g, ' ');

const hm = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
export const formatTime = (iso: string) => hm.format(new Date(iso));

const day = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
export const formatDay = (iso: string) => day.format(new Date(iso)).replace(/\./g, '');

const dayLong = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
export const formatDayLong = (iso: string) => dayLong.format(new Date(iso));

/** AAAA-MM-DD en hora de Lima, `offset` días desde hoy. */
export function limaDate(offset = 0): string {
  const t = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(t);
}

export const SPORTS: Record<Sport, string> = { football: 'Fútbol', volleyball: 'Vóley', padel: 'Pádel', basketball: 'Básquet' };
export const LEVELS: Record<Level, string> = { casual: 'Casual', intermediate: 'Intermedio', advanced: 'Avanzado' };
export const LEVEL_HINT: Record<Level, string> = {
  casual: 'Para pasarla bien',
  intermediate: 'Se juega en serio',
  advanced: 'Ritmo alto',
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
