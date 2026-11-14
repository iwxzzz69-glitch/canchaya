import Link from 'next/link';
import { formatDay, formatMoney, formatTime, LEVELS, SPORTS, plural } from '../_lib/format';
import type { Match, Venue } from '../_lib/types';
import { SpotPips, Stars } from './ui';

export function VenueCard({ venue }: { venue: Venue }) {
  const sports = Array.from(new Set(venue.courts.map((c) => c.sport)));
  const from = venue.courts.length ? Math.min(...venue.courts.map((c) => Number(c.pricePerHour))) : null;
  return (
    <Link href={`/canchas/${venue.id}`} className="line-card group flex items-stretch justify-between gap-4 p-5 transition hover:border-lamp/70">
      <div className="min-w-0">
        <h3 className="truncate font-display text-3xl font-extrabold leading-tight tracking-wide">{venue.name}</h3>
        <p className="mt-0.5 truncate text-mute">{venue.zone} · {venue.address}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {venue.rating.count > 0 ? (
            <span className="inline-flex items-center gap-1.5"><Stars value={venue.rating.average ?? 0} size={15} />
              <span className="num text-lg">{venue.rating.average?.toFixed(1)}</span>
              <span className="text-mute">({plural(venue.rating.count, 'reseña', 'reseñas')})</span></span>
          ) : <span className="text-mute">Sin reseñas todavía</span>}
        </p>
        <p className="mt-3 flex flex-wrap gap-2">
          {sports.map((s) => <span key={s} className="rounded-full border px-3 py-0.5 text-sm text-mute" style={{ borderWidth: 1.5 }}>{SPORTS[s]}</span>)}
        </p>
      </div>
      {from !== null && (
        <div className="shrink-0 self-end text-right">
          <p className="text-sm text-mute">desde</p>
          <p className="num text-4xl leading-none text-lamp">{formatMoney(from)}</p>
          <p className="text-sm text-mute">por hora</p>
        </div>
      )}
    </Link>
  );
}

export function MatchCard({ match }: { match: Match }) {
  return (
    <Link href={`/partidos/${match.id}`} className="line-card flex items-stretch gap-4 p-5 transition hover:border-lamp/70">
      <div className="w-[5.5rem] shrink-0 border-r pr-4 text-center" style={{ borderRightWidth: 1.5 }}>
        <p className="num text-5xl leading-none text-lamp">{formatTime(match.startsAt)}</p>
        <p className="mt-1 text-sm cap-first text-mute">{formatDay(match.startsAt)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-2xl font-extrabold tracking-wide">{match.venue.name}</h3>
        <p className="truncate text-sm text-mute">{match.court.name} · {match.venue.zone}</p>
        <p className="mt-2 flex flex-wrap gap-x-3 text-sm">
          <span>{SPORTS[match.sport]}</span>
          <span className="text-mute">{LEVELS[match.level]}</span>
          <span className="text-mute">Organiza {match.organizer}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-2 text-right">
        <div className="max-w-[7.5rem] flex-1"><SpotPips total={match.spotsTotal} taken={match.spotsTaken} /></div>
        <div>
          <p className="text-sm font-semibold">{match.spotsLeft > 0 ? `Faltan ${match.spotsLeft}` : 'Completo'}</p>
          <p className="text-sm text-mute">{formatMoney(match.suggestedPricePerPlayer)} c/u</p>
        </div>
      </div>
    </Link>
  );
}
