'use client';
import Link from 'next/link';
import { api, CHAT_URL } from '../_lib/api';
import { formatDay, formatTime } from '../_lib/format';
import type { Room } from '../_lib/types';
import { useQuery } from '../_lib/use-query';
import { Empty, ErrorBox, Loading, PageHead, RequireAuth } from '../_components/ui';

function Content() {
  const { data, error, loading, reload } = useQuery(() => api<Room[]>('/rooms', { base: CHAT_URL }), []);
  return (
    <>
      <PageHead title="Chat" hint="Habla con el local de tus reservas y coordina con los jugadores de tus partidos." />
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.length ? (
        <Empty title="Aún no tienes conversaciones" hint="Aparecen solas cuando pagas una reserva o te unes a un partido.">
          <Link href="/canchas" className="btn-lamp">Buscar cancha</Link>
          <Link href="/partidos" className="btn-line">Ver partidos</Link>
        </Empty>
      ) : (
        <ul className="space-y-3">{data.map((r) => (
          <li key={r.id}>
            <Link href={`/chat/${encodeURIComponent(r.id)}`} className={`line-card flex items-center gap-4 p-4 transition hover:border-lamp/70 ${r.status === 'closed' ? 'opacity-70' : ''}`}>
              <div className="w-20 shrink-0 text-center">
                <p className="num text-4xl leading-none text-lamp">{formatTime(r.startsAt)}</p>
                <p className="mt-1 text-sm cap-first text-mute">{formatDay(r.startsAt)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-2xl font-extrabold tracking-wide">{r.venueName}</h2>
                <p className="truncate text-sm text-mute">{r.courtName} · {r.kind === 'match' ? `Partido, ${r.memberIds.length} jugadores` : 'Reserva, chat con el local'}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${r.status === 'open' ? 'border-free text-free' : 'border-mute text-mute'}`} style={{ borderWidth: 1.5 }}>
                {r.status === 'open' ? 'Abierta' : 'Cerrada'}
              </span>
            </Link>
          </li>))}</ul>
      )}
    </>
  );
}
export default function Page() { return <RequireAuth><Content /></RequireAuth>; }
