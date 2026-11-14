'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '../../_lib/api';
import { formatDayLong, formatMoney, formatTime, LEVELS, LEVEL_HINT, SPORTS } from '../../_lib/format';
import { useSession } from '../../_lib/session';
import type { Match, Page } from '../../_lib/types';
import { useQuery } from '../../_lib/use-query';
import { ErrorBox, Loading, Notice, SpotPips } from '../../_components/ui';

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const match = useQuery(() => api<Match>(`/matches/${id}`, { auth: false }), [id]);
  const mine = useQuery(user ? () => api<Match[] | Page<Match>>('/matches/mine') : null, [user?.id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const mineList = Array.isArray(mine.data) ? mine.data : mine.data?.data ?? [];
  const role = mineList.find((m) => m.id === id)?.role;

  async function act(path: string, method: 'POST' | 'DELETE', ok: string, errors: Record<number, string> = {}) {
    if (!user) return router.push(`/login?next=${encodeURIComponent(`/partidos/${id}`)}`);
    setBusy(true); setMsg(null);
    try { await api(path, { method }); setMsg({ tone: 'ok', text: ok }); match.reload(); mine.reload(); }
    catch (e) { setMsg({ tone: 'error', text: e instanceof ApiError ? errors[e.status] ?? e.message : 'No se pudo completar.' }); match.reload(); }
    setBusy(false);
  }

  if (match.loading && !match.data) return <Loading />;
  if (match.error) return <ErrorBox error={match.error} onRetry={match.reload} />;
  const m = match.data!;
  const open = m.status === 'open';
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/partidos" className="text-sm text-mute hover:text-chalk">‹ Partidos abiertos</Link>
      <h1 className="mt-2 font-display text-5xl font-extrabold leading-none tracking-wide">{SPORTS[m.sport]} en {m.venue.name}</h1>
      <p className="mt-2 text-mute">{m.court.name} · {m.venue.address}, {m.venue.zone}</p>
      <div className="line-card mt-6 p-5">
        <p className="cap-first">{formatDayLong(m.startsAt)}</p>
        <p className="num text-5xl leading-none text-lamp">{formatTime(m.startsAt)} – {formatTime(m.endsAt)}</p>
        <p className="mt-4"><span className="font-semibold">{LEVELS[m.level]}</span> <span className="text-mute">· {LEVEL_HINT[m.level]}</span></p>
        {m.notes && <p className="mt-2 text-chalk/90">“{m.notes}”</p>}
        <div className="mt-5 flex items-end justify-between gap-4 border-t pt-4">
          <div><SpotPips total={m.spotsTotal} taken={m.spotsTaken} />
            <p className="mt-2 font-semibold">{!open ? 'Partido cancelado' : m.spotsLeft > 0 ? `Faltan ${m.spotsLeft} de ${m.spotsTotal}` : 'Completo'}</p></div>
          <div className="text-right"><p className="num text-3xl">{formatMoney(m.suggestedPricePerPlayer)}</p><p className="text-sm text-mute">por jugador, aprox.</p></div>
        </div>
      </div>
      <section className="mt-6" aria-label="Jugadores">
        <h2 className="mb-2 font-display text-2xl font-extrabold tracking-wide">Quiénes juegan</h2>
        <ul className="line-card divide-y p-2">
          <li className="flex justify-between px-3 py-2"><span>{m.organizer}</span><span className="text-mute">Organiza</span></li>
          {(m.players ?? []).map((p, i) => <li key={i} className="px-3 py-2">{p.name}</li>)}
        </ul>
      </section>
      {msg && <div className="mt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mt-6 flex flex-wrap gap-3">
        {open && role === 'organizer' && <button className="btn-line" disabled={busy} onClick={() => confirm('¿Cancelar el partido para todos?') && act(`/matches/${id}`, 'DELETE', 'Partido cancelado.')}>Cancelar partido</button>}
        {open && role === 'player' && <button className="btn-line" disabled={busy} onClick={() => act(`/matches/${id}/leave`, 'POST', 'Saliste del partido.')}>Salir del partido</button>}
        {open && !role && <button className="btn-lamp" disabled={busy || m.spotsLeft === 0}
          onClick={() => act(`/matches/${id}/join`, 'POST', '¡Estás dentro! Nos vemos en la cancha.', { 409: 'Ya no quedan lugares o no puedes unirte a este partido.' })}>
          {m.spotsLeft === 0 ? 'Partido completo' : user ? 'Unirme al partido' : 'Ingresa para unirte'}</button>}
        {role && <Link href={`/chat/${encodeURIComponent(`match:${id}`)}`} className="btn-lamp">Chat del partido</Link>}
        {open && role && <span className="self-center text-free">{role === 'organizer' ? 'Tú organizas este partido' : 'Estás en este partido'}</span>}
      </div>
    </div>
  );
}
