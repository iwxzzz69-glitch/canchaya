'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiError, api } from '../../_lib/api';
import { formatDayLong, formatMoney, formatTime, limaDate, plural, SPORTS } from '../../_lib/format';
import { useSession } from '../../_lib/session';
import type { Availability, Booking, ReviewPage, Venue } from '../../_lib/types';
import { useQuery } from '../../_lib/use-query';
import { SlotBoard } from '../../_components/SlotBoard';
import { Empty, ErrorBox, Loading, Notice, Stars } from '../../_components/ui';

const dayChip = (offset: number) => {
  const iso = limaDate(offset);
  const d = new Date(iso + 'T12:00:00-05:00');
  const wd = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'short' }).format(d).replace('.', '');
  return { iso, wd: offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : wd, n: Number(iso.slice(8)) };
};

export default function VenuePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const venue = useQuery(() => api<Venue>(`/venues/${id}`, { auth: false }), [id]);
  const reviews = useQuery(() => api<ReviewPage>(`/venues/${id}/reviews`, { auth: false }), [id]);
  const [courtId, setCourtId] = useState('');
  const [offset, setOffset] = useState(0);
  const [start, setStart] = useState<string | null>(null);
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => dayChip(i)), []);

  const court = venue.data?.courts.find((c) => c.id === (courtId || venue.data?.courts[0]?.id));
  const date = days[offset].iso;
  const avail = useQuery(court ? () => api<Availability>(`/courts/${court.id}/availability?date=${date}`, { auth: false }) : null, [court?.id, date]);

  function pickSlot(startsAt: string) {
    setProblem('');
    // Tocar la hora siguiente a la elegida la agrega (hasta 3 horas seguidas); cualquier otra empieza de nuevo.
    if (start && hours < 3) {
      const end = new Date(start).getTime() + hours * 3_600_000;
      if (new Date(startsAt).getTime() === end) return setHours(hours + 1);
    }
    if (start === startsAt) { setStart(null); return setHours(1); }
    setStart(startsAt); setHours(1);
  }
  const reset = () => { setStart(null); setHours(1); setProblem(''); };

  async function book() {
    if (!court || !start) return;
    if (!user) return router.push(`/login?next=${encodeURIComponent(`/canchas/${id}`)}`);
    setBusy(true); setProblem('');
    try {
      const b = await api<Booking>('/bookings', { method: 'POST', body: { courtId: court.id, startsAt: start, hours } });
      router.push(`/reservas/${b.id}`);
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.status === 409 ? 'Alguien reservó esa hora justo antes. Elige otra.' : e.message) : 'No se pudo reservar.');
      if (e instanceof ApiError && e.status === 409) { reset(); avail.reload(); }
      setBusy(false);
    }
  }

  if (venue.loading && !venue.data) return <Loading />;
  if (venue.error) return <ErrorBox error={venue.error} onRetry={venue.reload} />;
  const v = venue.data!;
  const total = court && start ? Number(court.pricePerHour) * hours : 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0">
        <Link href="/canchas" className="text-sm text-mute hover:text-chalk">‹ Todas las canchas</Link>
        <h1 className="mt-2 font-display text-5xl font-extrabold leading-none tracking-wide sm:text-6xl">{v.name}</h1>
        <p className="mt-2 text-mute">{v.address}, {v.zone}</p>
        {v.description && <p className="mt-3 max-w-prose">{v.description}</p>}
        <p className="mt-3 flex items-center gap-2">
          {v.rating.count > 0 ? <><Stars value={v.rating.average ?? 0} /><span className="num text-xl">{v.rating.average?.toFixed(1)}</span>
            <span className="text-mute">({plural(v.rating.count, 'reseña', 'reseñas')})</span></> : <span className="text-mute">Sin reseñas todavía</span>}
        </p>

        {!v.courts.length ? <div className="mt-8"><Empty title="Este local aún no tiene canchas" /></div> : (
          <>
            <section className="mt-8" aria-label="Cancha">
              <div role="group" aria-label="Cancha" className="flex flex-wrap gap-2">
                {v.courts.map((c) => (
                  <button key={c.id} className="chip" aria-pressed={c.id === court?.id} onClick={() => { setCourtId(c.id); reset(); }}>
                    {c.name} · {SPORTS[c.sport]} · {formatMoney(c.pricePerHour)}/h
                  </button>
                ))}
              </div>
            </section>
            <section className="mt-6" aria-label="Día">
              <div role="group" aria-label="Día" className="flex gap-2 overflow-x-auto pb-2">
                {days.map((d, i) => (
                  <button key={d.iso} className="chip min-w-[4.5rem] flex-col !gap-0 !py-2" aria-pressed={i === offset} onClick={() => { setOffset(i); reset(); }}>
                    <span className="text-xs cap-first">{d.wd}</span><span className="num text-2xl">{d.n}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="mt-4" aria-live="polite">
              <h2 className="mb-3 font-display text-2xl font-semibold cap-first tracking-wide">{formatDayLong(date + 'T12:00:00-05:00')}</h2>
              {avail.loading && !avail.data ? <Loading label="Buscando horas…" /> : avail.error ? <ErrorBox error={avail.error} onRetry={avail.reload} /> :
                <SlotBoard slots={avail.data?.slots ?? []} pick={start ? { startsAt: start, hours } : null} onPick={pickSlot} />}
              <p className="mt-3 text-sm text-mute">Toca una hora libre. Toca la siguiente para sumar hasta 3 seguidas.</p>
            </section>
          </>
        )}

        <section className="mt-12" aria-label="Reseñas">
          <h2 className="mb-4 font-display text-3xl font-extrabold tracking-wide">Lo que dicen los jugadores</h2>
          {reviews.loading && !reviews.data ? <Loading /> : !reviews.data?.data.length ? (
            <p className="text-mute">Todavía nadie reseñó este local. Las reseñas llegan después de jugar.</p>
          ) : (
            <ul className="space-y-3">{reviews.data.data.map((r) => (
              <li key={r.id} className="line-card p-4">
                <div className="flex items-center justify-between gap-3"><span className="font-semibold">{r.author}</span><Stars value={r.rating} size={16} /></div>
                {r.comment && <p className="mt-2 text-chalk/90">{r.comment}</p>}
              </li>))}</ul>
          )}
        </section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Resumen de tu reserva">
        <div className="line-card p-5">
          <h2 className="font-display text-2xl font-extrabold tracking-wide">Tu reserva</h2>
          {court && start ? (
            <dl className="mt-3 space-y-1">
              <div className="flex justify-between"><dt className="text-mute">Cancha</dt><dd>{court.name}</dd></div>
              <div className="flex justify-between"><dt className="text-mute">Día</dt><dd className="cap-first">{formatDayLong(start)}</dd></div>
              <div className="flex justify-between"><dt className="text-mute">Horario</dt>
                <dd className="num text-xl">{formatTime(start)} – {formatTime(new Date(new Date(start).getTime() + hours * 3_600_000).toISOString())}</dd></div>
              <div className="flex justify-between border-t pt-3"><dt className="text-mute">Total</dt><dd className="num text-3xl text-lamp">{formatMoney(total)}</dd></div>
            </dl>
          ) : <p className="mt-2 text-mute">Elige una hora libre para ver el total.</p>}
          {problem && <div className="mt-3"><Notice tone="error">{problem}</Notice></div>}
          <button className="btn-lamp mt-4 w-full" disabled={!start || busy} onClick={book}>{busy ? 'Reservando…' : user ? 'Reservar y pagar' : 'Ingresa para reservar'}</button>
          <p className="mt-3 text-sm text-mute">Te guardamos la hora unos minutos mientras pagas.</p>
        </div>
      </aside>
    </div>
  );
}
