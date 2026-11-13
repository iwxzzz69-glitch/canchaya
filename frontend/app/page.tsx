'use client';
import Link from 'next/link';
import { api } from './_lib/api';
import { limaDate } from './_lib/format';
import type { Availability, Match, Page, Venue } from './_lib/types';
import { useQuery } from './_lib/use-query';
import { MatchCard, VenueCard } from './_components/Cards';
import { SlotBoard } from './_components/SlotBoard';
import { Loading } from './_components/ui';

export default function Home() {
  const venues = useQuery(() => api<Page<Venue>>('/venues?limit=6', { auth: false }), []);
  const matches = useQuery(() => api<Page<Match>>('/matches?limit=3', { auth: false }), []);
  const first = venues.data?.data.find((v) => v.courts.length);
  const court = first?.courts[0];
  // Hoy y mañana: de noche quedan pocas horas hoy, y un tablero casi vacío no dice nada.
  const board = useQuery(court ? async () => {
    const days = await Promise.all([0, 1].map((o) => api<Availability>(`/courts/${court.id}/availability?date=${limaDate(o)}`, { auth: false })));
    return days.flatMap((d) => d.slots).filter((x) => new Date(x.startsAt).getTime() > Date.now()).slice(0, 9);
  } : null, [court?.id]);

  return (
    <>
      <section className="grid items-center gap-8 pb-12 pt-4 lg:grid-cols-2">
        <div>
          <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-wide sm:text-7xl">¿Hay cancha esta noche?</h1>
          <p className="mt-5 max-w-md text-lg text-mute">Mira las horas libres de cada local, reserva y paga en minutos. ¿Te falta gente? Publica tu partido y completa el equipo.</p>
          <div className="mt-7 grid gap-3 sm:flex">
            <Link href="/canchas" className="btn-lamp">Buscar cancha</Link>
            <Link href="/partidos" className="btn-line">Ver partidos abiertos</Link>
          </div>
        </div>
        <div className="line-card p-5" aria-label="Horas de hoy">
          {first && court ? (
            <>
              <p className="font-display text-2xl font-extrabold tracking-wide">{first.name} · {court.name}</p>
              <p className="mb-4 text-sm text-mute">Próximas horas</p>
              {board.data ? <SlotBoard slots={board.data} markTomorrow /> : <Loading label="Buscando horas…" />}
              <Link href={`/canchas/${first.id}`} className="btn-line mt-4 w-full">Reservar en este local</Link>
            </>
          ) : venues.loading ? <Loading /> : <p className="py-10 text-center text-mute">Pronto verás aquí las horas libres de hoy.</p>}
        </div>
      </section>

      {!!matches.data?.data.length && (
        <section className="pb-12" aria-label="Partidos abiertos">
          <div className="mb-4 flex items-end justify-between"><h2 className="font-display text-4xl font-extrabold tracking-wide">Faltan jugadores</h2><Link href="/partidos" className="text-lamp underline underline-offset-4">Ver todos</Link></div>
          <ul className="grid gap-4 lg:grid-cols-3">{matches.data.data.map((m) => <li key={m.id}><MatchCard match={m} /></li>)}</ul>
        </section>
      )}
      {!!venues.data?.data.length && (
        <section aria-label="Canchas">
          <div className="mb-4 flex items-end justify-between"><h2 className="font-display text-4xl font-extrabold tracking-wide">Canchas</h2><Link href="/canchas" className="text-lamp underline underline-offset-4">Ver todas</Link></div>
          <ul className="grid gap-4 md:grid-cols-2">{venues.data.data.map((v) => <li key={v.id}><VenueCard venue={v} /></li>)}</ul>
        </section>
      )}
    </>
  );
}
