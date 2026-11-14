'use client';
import { useState } from 'react';
import { api, query } from '../_lib/api';
import { LEVELS, limaDate, SPORTS } from '../_lib/format';
import type { Level, Match, Page, Sport } from '../_lib/types';
import { useQuery } from '../_lib/use-query';
import { MatchCard } from '../_components/Cards';
import { Empty, ErrorBox, Loading, PageHead } from '../_components/ui';

export default function Partidos() {
  const [sport, setSport] = useState<Sport | ''>('');
  const [level, setLevel] = useState<Level | ''>('');
  const [date, setDate] = useState('');
  const { data, error, loading, reload } = useQuery(
    () => api<Page<Match>>('/matches' + query({ sport, level, date, limit: 50 }), { auth: false }), [sport, level, date]);
  return (
    <>
      <PageHead title="Partidos abiertos" hint="Reservas con lugares libres. Súmate, paga tu parte y a jugar." />
      <div className="mb-6 flex flex-col gap-4">
        <div role="group" aria-label="Deporte" className="flex flex-wrap gap-2">
          <button className="chip" aria-pressed={sport === ''} onClick={() => setSport('')}>Todos</button>
          {(Object.keys(SPORTS) as Sport[]).map((s) => <button key={s} className="chip" aria-pressed={sport === s} onClick={() => setSport(s)}>{SPORTS[s]}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div role="group" aria-label="Nivel" className="flex flex-wrap gap-2">
            <button className="chip" aria-pressed={level === ''} onClick={() => setLevel('')}>Cualquier nivel</button>
            {(Object.keys(LEVELS) as Level[]).map((l) => <button key={l} className="chip" aria-pressed={level === l} onClick={() => setLevel(l)}>{LEVELS[l]}</button>)}
          </div>
          <div><label className="label" htmlFor="d">Día</label><input id="d" type="date" className="field" min={limaDate(0)} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.data.length ? (
        <Empty title="No hay partidos con esos filtros" hint="Reserva una cancha y publica tu propio partido desde Mis reservas." />
      ) : <ul className="grid gap-4 lg:grid-cols-2">{data.data.map((m) => <li key={m.id}><MatchCard match={m} /></li>)}</ul>}
    </>
  );
}
