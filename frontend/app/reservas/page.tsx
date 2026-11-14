'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '../_lib/api';
import { formatDay, formatMoney, formatTime, LEVELS, SPORTS } from '../_lib/format';
import type { Booking, Level, Match, Review } from '../_lib/types';
import { useQuery } from '../_lib/use-query';
import { Empty, ErrorBox, Loading, Modal, Notice, PageHead, RequireAuth, StarInput, StatusChip } from '../_components/ui';

function Content() {
  const router = useRouter();
  const { data, error, loading, reload } = useQuery(() => api<Booking[]>('/bookings/mine'), []);
  const [tab, setTab] = useState<'next' | 'past'>('next');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [recruit, setRecruit] = useState<Booking | null>(null);
  const [review, setReview] = useState<Booking | null>(null);
  const now = Date.now();
  const isNext = (b: Booking) => (b.status === 'pending' || b.status === 'confirmed') && new Date(b.endsAt).getTime() > now;
  const list = (data ?? []).filter((b) => (tab === 'next' ? isNext(b) : !isNext(b)))
    .sort((a, b) => (tab === 'next' ? 1 : -1) * (new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));

  async function cancel(b: Booking) {
    if (!confirm('¿Cancelar esta reserva?')) return;
    try {
      const r = await api<{ refund: 'none' | 'refunded' | 'failed' }>(`/bookings/${b.id}/cancel`, { method: 'POST' });
      setMsg({ tone: r.refund === 'failed' ? 'error' : 'ok', text:
        r.refund === 'refunded' ? 'Reserva cancelada. Te devolvimos el pago.' :
        r.refund === 'failed' ? 'Reserva cancelada, pero la devolución no se pudo procesar. Ya quedó en cola para revisión.' : 'Reserva cancelada.' });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'No se pudo cancelar.' }); }
  }

  return (
    <>
      <PageHead title="Mis reservas" />
      <div role="group" aria-label="Filtrar" className="mb-5 flex gap-2">
        <button className="chip" aria-pressed={tab === 'next'} onClick={() => setTab('next')}>Próximas</button>
        <button className="chip" aria-pressed={tab === 'past'} onClick={() => setTab('past')}>Anteriores</button>
      </div>
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !list.length ? (
        <Empty title={tab === 'next' ? 'No tienes reservas próximas' : 'Aún no tienes historial'} hint={tab === 'next' ? 'Busca una cancha y reserva tu hora.' : undefined}>
          {tab === 'next' && <Link href="/canchas" className="btn-lamp">Buscar cancha</Link>}
        </Empty>
      ) : (
        <ul className="space-y-3">{list.map((b) => {
          const finished = b.status === 'confirmed' && new Date(b.endsAt).getTime() <= now;
          return (
            <li key={b.id} className="line-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <div className="w-24 shrink-0">
                <p className="num text-5xl leading-none text-lamp">{formatTime(b.startsAt)}</p>
                <p className="mt-1 text-sm cap-first text-mute">{formatDay(b.startsAt)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-2xl font-extrabold tracking-wide">{b.venue.name}</h3>
                <p className="text-sm text-mute">{b.court.name} · {SPORTS[b.court.sport]} · hasta las {formatTime(b.endsAt)} · {formatMoney(b.totalPrice)}</p>
                <div className="mt-2"><StatusChip status={b.status} /></div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {b.status === 'pending' && <Link href={`/reservas/${b.id}`} className="btn-lamp">Pagar</Link>}
                {b.status === 'confirmed' && !finished && !b.matchId && <button className="btn-line" onClick={() => setRecruit(b)}>Buscar jugadores</button>}
                {b.status === 'confirmed' && <Link href={`/chat/${b.id}`} className="btn-line">Chat con el local</Link>}
                {b.matchId && <Link href={`/partidos/${b.matchId}`} className="btn-line">Ver partido</Link>}
                {finished && !b.reviewed && <button className="btn-line" onClick={() => setReview(b)}>Reseñar</button>}
                {finished && b.reviewed && <span className="self-center text-sm text-mute">Ya la reseñaste</span>}
                {(b.status === 'pending' || (b.status === 'confirmed' && !finished)) && <button className="btn-quiet" onClick={() => cancel(b)}>Cancelar</button>}
              </div>
            </li>
          );
        })}</ul>
      )}
      {recruit && <RecruitModal booking={recruit} onClose={() => setRecruit(null)} onDone={(m) => router.push(`/partidos/${m.id}`)} />}
      {review && <ReviewModal booking={review} onClose={() => setReview(null)} onDone={() => { setReview(null); setMsg({ tone: 'ok', text: '¡Gracias! Tu reseña ya es pública.' }); reload(); }} />}
    </>
  );
}

function RecruitModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (m: Match) => void }) {
  const [spots, setSpots] = useState(booking.court.sport === 'football' ? 4 : 2);
  const [level, setLevel] = useState<Level>('casual');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { onDone(await api<Match>('/matches', { method: 'POST', body: { bookingId: booking.id, spots, level, notes: notes.trim() || undefined } })); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'No se pudo publicar.'); setBusy(false); }
  }
  return (
    <Modal title="Buscar jugadores" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-mute">Publicamos tu reserva en {booking.venue.name} para que otros se sumen y dividan el costo.</p>
        <div><label className="label" htmlFor="spots">¿Cuántos jugadores faltan?</label>
          <input id="spots" type="number" min={1} max={20} className="field num" value={spots} onChange={(e) => setSpots(Number(e.target.value))} required /></div>
        <div><span className="label" id="lvl">Nivel</span>
          <div role="group" aria-labelledby="lvl" className="flex flex-wrap gap-2">
            {(Object.keys(LEVELS) as Level[]).map((l) => <button type="button" key={l} className="chip" aria-pressed={level === l} onClick={() => setLevel(l)}>{LEVELS[l]}</button>)}
          </div></div>
        <div><label className="label" htmlFor="notes">Nota (opcional)</label>
          <textarea id="notes" className="field" rows={2} maxLength={300} placeholder="Traer polo oscuro, hay balón…" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn-lamp w-full" disabled={busy}>{busy ? 'Publicando…' : 'Publicar partido'}</button>
      </form>
    </Modal>
  );
}

function ReviewModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setError('Elige de 1 a 5 estrellas.');
    setBusy(true); setError('');
    try { await api<Review>(`/bookings/${booking.id}/review`, { method: 'POST', body: { rating, comment: comment.trim() || undefined } }); onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'No se pudo enviar.'); setBusy(false); }
  }
  return (
    <Modal title={`Reseña de ${booking.venue.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <StarInput value={rating} onChange={setRating} />
        <div><label className="label" htmlFor="comment">Comentario (opcional)</label>
          <textarea id="comment" className="field" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn-lamp w-full" disabled={busy}>{busy ? 'Enviando…' : 'Publicar reseña'}</button>
      </form>
    </Modal>
  );
}

export default function Page() { return <RequireAuth><Content /></RequireAuth>; }
