'use client';
import { useState } from 'react';
import { api, query } from '../_lib/api';
import { SPORTS } from '../_lib/format';
import type { Page, Sport, Venue } from '../_lib/types';
import { useQuery } from '../_lib/use-query';
import { VenueCard } from '../_components/Cards';
import { Empty, ErrorBox, Loading, PageHead } from '../_components/ui';

export default function Canchas() {
  const [sport, setSport] = useState<Sport | ''>('');
  const [zone, setZone] = useState('');
  const [debounced, setDebounced] = useState('');
  const { data, error, loading, reload } = useQuery(
    () => api<Page<Venue>>('/venues' + query({ sport, zone: debounced, limit: 50 }), { auth: false }),
    [sport, debounced],
  );
  return (
    <>
      <PageHead title="Canchas" hint="Elige un local, mira qué horas están libres y reserva en minutos." />
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="sm:w-72">
          <label className="label" htmlFor="zone">Zona</label>
          <input id="zone" className="field" placeholder="Miraflores, San Borja…" value={zone}
            onChange={(e) => setZone(e.target.value)} onBlur={() => setDebounced(zone.trim())}
            onKeyDown={(e) => e.key === 'Enter' && setDebounced(zone.trim())} />
        </div>
        <div role="group" aria-label="Deporte" className="flex flex-wrap gap-2">
          <button className="chip" aria-pressed={sport === ''} onClick={() => setSport('')}>Todos</button>
          {(Object.keys(SPORTS) as Sport[]).map((s) => (
            <button key={s} className="chip" aria-pressed={sport === s} onClick={() => setSport(s)}>{SPORTS[s]}</button>
          ))}
        </div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.data.length ? (
        <Empty title="No hay canchas con esos filtros" hint="Prueba con otra zona u otro deporte." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">{data.data.map((v) => <li key={v.id}><VenueCard venue={v} /></li>)}</ul>
      )}
    </>
  );
}
