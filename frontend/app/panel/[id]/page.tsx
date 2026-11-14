'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiError, api } from '../../_lib/api';
import { formatDayLong, formatMoney, formatTime, limaDate, SPORTS } from '../../_lib/format';
import type { AgendaBooking, Court, Sport, Venue } from '../../_lib/types';
import { useQuery } from '../../_lib/use-query';
import { Empty, ErrorBox, Loading, Modal, Notice, RequireAuth, StatusChip } from '../../_components/ui';

function CourtForm({ venueId, court, onClose, onDone }: { venueId: string; court?: Court; onClose: () => void; onDone: () => void }) {
  const [sport, setSport] = useState<Sport>(court?.sport ?? 'football');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get('name')).trim(), sport, pricePerHour: Number(f.get('price')),
      openHour: Number(f.get('open')), closeHour: Number(f.get('close')),
    };
    if (body.closeHour <= body.openHour) return setError('La hora de cierre debe ser después de la de apertura.');
    setBusy(true); setError('');
    try {
      if (court) await api(`/courts/${court.id}`, { method: 'PATCH', body });
      else await api(`/venues/${venueId}/courts`, { method: 'POST', body });
      onDone();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'No se pudo guardar la cancha.'); setBusy(false); }
  }
  return (
    <Modal title={court ? `Editar ${court.name}` : 'Nueva cancha'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="cn">Nombre</label><input id="cn" name="name" className="field" required maxLength={80} defaultValue={court?.name} placeholder="Cancha 1" /></div>
        <div><span className="label" id="cs">Deporte</span>
          <div role="group" aria-labelledby="cs" className="flex flex-wrap gap-2">
            {(Object.keys(SPORTS) as Sport[]).map((s) => <button type="button" key={s} className="chip" aria-pressed={sport === s} onClick={() => setSport(s)}>{SPORTS[s]}</button>)}
          </div></div>
        <div><label className="label" htmlFor="cp">Precio por hora (S/)</label><input id="cp" name="price" type="number" step="0.01" min="0.01" max="100000" className="field num" required defaultValue={court?.pricePerHour} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="co">Abre (hora)</label><input id="co" name="open" type="number" min={0} max={23} className="field num" required defaultValue={court?.openHour ?? 8} /></div>
          <div><label className="label" htmlFor="cc">Cierra (hora)</label><input id="cc" name="close" type="number" min={1} max={24} className="field num" required defaultValue={court?.closeHour ?? 23} /></div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn-lamp w-full" disabled={busy}>{busy ? 'Guardando…' : court ? 'Guardar cambios' : 'Crear cancha'}</button>
      </form>
    </Modal>
  );
}

function Content() {
  const { id } = useParams<{ id: string }>();
  const mine = useQuery(() => api<Venue[]>('/venues/mine'), []);
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => limaDate(i)), []);
  const agenda = useQuery(() => api<AgendaBooking[]>(`/venues/${id}/bookings?date=${days[offset]}`), [id, offset]);
  const [form, setForm] = useState<{ court?: Court } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const venue = mine.data?.find((v) => v.id === id);
  async function toggle(c: Court) {
    try { await api(`/courts/${c.id}`, { method: 'PATCH', body: { isActive: c.isActive === false } }); setMsg({ tone: 'ok', text: c.isActive === false ? `${c.name} vuelve a recibir reservas.` : `${c.name} ya no recibe reservas nuevas.` }); mine.reload(); }
    catch (e) { setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'No se pudo cambiar.' }); }
  }

  if (mine.loading && !mine.data) return <Loading />;
  if (mine.error) return <ErrorBox error={mine.error} onRetry={mine.reload} />;
  if (!venue) return <Empty title="No encontramos este local" hint="Puede que no sea tuyo."><Link href="/panel" className="btn-line">Volver a mi panel</Link></Empty>;

  return (
    <div className="grid gap-10 lg:grid-cols-[22rem_1fr]">
      <section aria-label="Canchas">
        <Link href="/panel" className="text-sm text-mute hover:text-chalk">‹ Mi panel</Link>
        <h1 className="mt-2 font-display text-5xl font-extrabold leading-none tracking-wide">{venue.name}</h1>
        <p className="mt-1 text-mute">{venue.zone} · {venue.address}</p>
        <div className="mb-3 mt-6 flex items-center justify-between"><h2 className="font-display text-2xl font-extrabold tracking-wide">Canchas</h2><button className="btn-line !min-h-[40px]" onClick={() => setForm({})}>Agregar</button></div>
        {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        {!venue.courts.length ? <p className="text-mute">Todavía no hay canchas. Agrega la primera para recibir reservas.</p> : (
          <ul className="space-y-3">{venue.courts.map((c) => (
            <li key={c.id} className={`line-card p-4 ${c.isActive === false ? 'opacity-60' : ''}`}>
              <div className="flex items-baseline justify-between gap-2"><span className="font-display text-2xl font-extrabold tracking-wide">{c.name}</span><span className="num text-2xl text-lamp">{formatMoney(c.pricePerHour)}</span></div>
              <p className="text-sm text-mute">{SPORTS[c.sport]} · {String(c.openHour).padStart(2, '0')}:00 a {String(c.closeHour).padStart(2, '0')}:00{c.isActive === false ? ' · desactivada' : ''}</p>
              <div className="mt-3 flex gap-2"><button className="btn-quiet !min-h-[40px]" onClick={() => setForm({ court: c })}>Editar</button><button className="btn-quiet !min-h-[40px]" onClick={() => toggle(c)}>{c.isActive === false ? 'Activar' : 'Desactivar'}</button></div>
            </li>))}</ul>
        )}
      </section>

      <section aria-label="Reservas">
        <h2 className="font-display text-3xl font-extrabold tracking-wide">Reservas</h2>
        <div role="group" aria-label="Día" className="my-3 flex gap-2 overflow-x-auto pb-2">
          {days.map((d, i) => (
            <button key={d} className="chip min-w-[4.5rem] flex-col !gap-0 !py-2" aria-pressed={i === offset} onClick={() => setOffset(i)}>
              <span className="text-xs">{i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'short' }).format(new Date(d + 'T12:00:00-05:00')).replace('.', '')}</span>
              <span className="num text-2xl">{Number(d.slice(8))}</span>
            </button>))}
        </div>
        <p className="mb-3 cap-first text-mute">{formatDayLong(days[offset] + 'T12:00:00-05:00')}</p>
        {agenda.loading && !agenda.data ? <Loading /> : agenda.error ? <ErrorBox error={agenda.error} onRetry={agenda.reload} /> : !agenda.data?.length ? (
          <Empty title="Sin reservas este día" hint="Cuando alguien reserve una hora, aparecerá aquí." />
        ) : (
          <ul className="space-y-3">{agenda.data.map((b) => (
            <li key={b.id} className="line-card flex flex-wrap items-center gap-4 p-4">
              <div className="w-28 shrink-0"><p className="num text-4xl leading-none text-lamp">{formatTime(b.startsAt)}</p><p className="text-sm text-mute">hasta {formatTime(b.endsAt)}</p></div>
              <div className="min-w-0 flex-1"><p className="font-semibold">{b.player.name}</p><p className="text-sm text-mute">{b.court.name} · {formatMoney(b.totalPrice)}</p></div>
              <StatusChip status={b.status} />
              {b.status === 'confirmed' && <Link href={`/chat/${b.id}`} aria-label={`Chat con ${b.player.name}`} className="btn-line !min-h-[40px]">Chat</Link>}
            </li>))}</ul>
        )}
      </section>
      {form && <CourtForm venueId={id} court={form.court} onClose={() => setForm(null)} onDone={() => { setForm(null); mine.reload(); }} />}
    </div>
  );
}
export default function Page() { return <RequireAuth><Content /></RequireAuth>; }
