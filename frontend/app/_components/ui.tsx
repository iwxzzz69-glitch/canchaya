'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from '../_lib/session';
import type { ApiError } from '../_lib/api';
import type { BookingStatus } from '../_lib/types';

export function PageHead({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-4xl font-extrabold leading-none tracking-wide sm:text-5xl">{title}</h1>
        {hint && <p className="mt-2 max-w-prose text-mute">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="py-16 text-center text-mute">
      <span className="font-display text-2xl tracking-wide">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div role="alert" className="line-card border-alert/60 p-5">
      <p className="font-semibold text-alert">{error.status === 0 ? 'Sin conexión' : 'No se pudo cargar'}</p>
      <p className="mt-1 text-mute">{error.message}</p>
      {onRetry && <button onClick={onRetry} className="btn-line mt-4">Reintentar</button>}
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-14 text-center" style={{ borderWidth: 1.5 }}>
      <p className="font-display text-3xl font-semibold tracking-wide">{title}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-mute">{hint}</p>}
      {children && <div className="mt-5 flex justify-center gap-3">{children}</div>}
    </div>
  );
}

/** Aviso corto y accesible (confirmaciones y errores de una acción). */
export function Notice({ tone, children }: { tone: 'ok' | 'error' | 'info'; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'border-free/60 text-free' : tone === 'error' ? 'border-alert/60 text-alert' : 'border-lamp/60 text-lamp';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border bg-pitch px-4 py-3 text-sm ${color}`} style={{ borderWidth: 1.5 }}>
      <span className="text-chalk">{children}</span>
    </div>
  );
}

const STATUS: Record<BookingStatus, { label: string; cls: string }> = {
  pending: { label: 'Falta pagar', cls: 'border-lamp text-lamp' },
  confirmed: { label: 'Confirmada', cls: 'border-free text-free' },
  cancelled: { label: 'Cancelada', cls: 'border-mute text-mute' },
  expired: { label: 'Venció', cls: 'border-mute text-mute' },
};
export function StatusChip({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${s.cls}`} style={{ borderWidth: 1.5 }}>{s.label}</span>;
}

/** Cupos como puntos: los llenos en ámbar, los libres vacíos. */
export function SpotPips({ total, taken }: { total: number; taken: number }) {
  return (
    <span className="inline-flex flex-wrap gap-1" role="img" aria-label={`${taken} de ${total} lugares ocupados`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-3.5 w-3.5 rounded-full border ${i < taken ? 'border-lamp bg-lamp' : 'border-mute/70'}`} style={{ borderWidth: 1.5 }} />
      ))}
    </span>
  );
}

export function Stars({ value, size = 18 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5 text-lamp" role="img" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={n <= Math.round(value) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6">
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
        </svg>
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Calificación" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
          onClick={() => onChange(n)} className={`rounded-lg p-1.5 transition ${n <= value ? 'text-lamp' : 'text-mute hover:text-chalk'}`}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill={n <= value ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function Countdown({ until, onExpire }: { until: string; onExpire?: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()));
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const ms = Math.max(0, new Date(until).getTime() - Date.now());
      setLeft(ms);
      if (ms === 0 && !fired.current) { fired.current = true; onExpire?.(); }
    }, 500);
    return () => clearInterval(t);
  }, [until, onExpire]);
  const s = Math.ceil(left / 1000);
  const text = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return <span role="timer" aria-label={`Tiempo restante ${text}`} className={`num text-5xl ${s <= 60 ? 'text-alert' : 'text-lamp'}`}>{text}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="modal-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border bg-pitch p-0 text-chalk backdrop:bg-black/70" style={{ borderWidth: 1.5 }}>
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="modal-title" className="font-display text-3xl font-extrabold tracking-wide">{title}</h2>
          <button onClick={onClose} className="btn-quiet !px-2" aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Pide sesión: si no la hay, lleva a iniciar sesión y regresa después. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (ready && !user) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [ready, user, router, path]);
  if (!ready || !user) return <Loading label="Verificando tu sesión…" />;
  return <>{children}</>;
}
