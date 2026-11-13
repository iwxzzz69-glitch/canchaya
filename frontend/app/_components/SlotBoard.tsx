'use client';
import { formatTime, limaDate } from '../_lib/format';
import type { Slot } from '../_lib/types';

export interface Pick { startsAt: string; hours: number }

/** El tablero de turnos: cada hora es una ficha que se enciende cuando está libre. */
export function SlotBoard({ slots, pick, onPick, markTomorrow }: { slots: Slot[]; pick?: Pick | null; onPick?: (startsAt: string) => void; markTomorrow?: boolean }) {
  const start = pick ? new Date(pick.startsAt).getTime() : 0;
  const end = pick ? start + pick.hours * 3_600_000 : 0;
  const now = Date.now();
  const today = limaDate(0);
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {slots.map((s) => {
        const t = new Date(s.startsAt).getTime();
        const selected = pick ? t >= start && t < end : false;
        const past = t <= now;
        const label = formatTime(s.startsAt);
        const state = selected ? 'elegido' : s.available ? 'libre' : past ? 'ya pasó' : 'ocupado';
        const base = 'flex min-h-[76px] w-full flex-col items-center justify-center rounded-xl border text-center';
        const cls = selected
          ? 'border-lamp bg-lamp text-lamp-ink'
          : s.available
            ? 'slot-free border-lamp/70 bg-pitch text-chalk hover:border-lamp'
            : 'border-dashed bg-transparent text-mute/60';
        return (
          <li key={s.startsAt}>
            <button type="button" disabled={!s.available || !onPick} aria-pressed={selected} aria-label={`${label}, ${state}`}
              onClick={() => onPick?.(s.startsAt)} className={`${base} ${cls}`} style={{ borderWidth: 1.5 }}>
              <span className={`num text-[2rem] leading-none ${!s.available && !selected ? 'line-through decoration-mute/50' : ''}`}>{label}</span>
              <span className="mt-1 text-xs">{state}{markTomorrow && new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(s.startsAt)) !== today ? ' · mañana' : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
