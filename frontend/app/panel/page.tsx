'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, api } from '../_lib/api';
import { formatMoney, SPORTS } from '../_lib/format';
import { useSession } from '../_lib/session';
import type { Venue } from '../_lib/types';
import { useQuery } from '../_lib/use-query';
import { Empty, ErrorBox, Loading, Modal, Notice, PageHead, RequireAuth } from '../_components/ui';

function NewVenue({ onClose, onDone }: { onClose: () => void; onDone: (v: Venue) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      const description = String(f.get('description')).trim();
      onDone(await api<Venue>('/venues', { method: 'POST', body: { name: String(f.get('name')).trim(), address: String(f.get('address')).trim(), zone: String(f.get('zone')).trim(), ...(description ? { description } : {}) } }));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'No se pudo crear el local.'); setBusy(false); }
  }
  return (
    <Modal title="Nuevo local" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="vn">Nombre</label><input id="vn" name="name" className="field" required minLength={2} maxLength={120} /></div>
        <div><label className="label" htmlFor="va">Dirección</label><input id="va" name="address" className="field" required minLength={3} maxLength={200} /></div>
        <div><label className="label" htmlFor="vz">Zona o distrito</label><input id="vz" name="zone" className="field" required minLength={2} maxLength={80} placeholder="Miraflores" /></div>
        <div><label className="label" htmlFor="vd">Descripción (opcional)</label><textarea id="vd" name="description" className="field" rows={2} maxLength={1000} /></div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn-lamp w-full" disabled={busy}>{busy ? 'Creando…' : 'Crear local'}</button>
      </form>
    </Modal>
  );
}

function Content() {
  const { user } = useSession();
  const { data, error, loading, reload } = useQuery(() => api<Venue[]>('/venues/mine'), []);
  const [creating, setCreating] = useState(false);
  if (user && user.role !== 'owner') {
    return <Empty title="Este panel es para dueños de canchas" hint="Tu cuenta es de jugador. Crea una cuenta de dueño para publicar tus locales.">
      <Link href="/canchas" className="btn-lamp">Ver canchas</Link></Empty>;
  }
  return (
    <>
      <PageHead title="Mi panel" hint="Tus locales, sus canchas y las reservas que van llegando.">
        <button className="btn-lamp" onClick={() => setCreating(true)}>Nuevo local</button>
      </PageHead>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.length ? (
        <Empty title="Aún no tienes locales" hint="Crea tu primer local, agrega sus canchas y empezarás a recibir reservas.">
          <button className="btn-lamp" onClick={() => setCreating(true)}>Crear mi primer local</button></Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">{data.map((v) => (
          <li key={v.id}>
            <Link href={`/panel/${v.id}`} className="line-card block p-5 transition hover:border-lamp/70">
              <h2 className="font-display text-3xl font-extrabold tracking-wide">{v.name}</h2>
              <p className="text-mute">{v.zone} · {v.address}</p>
              <p className="mt-3 text-sm">
                {v.courts.length ? v.courts.map((c) => `${c.name} (${SPORTS[c.sport]}, ${formatMoney(c.pricePerHour)}/h${c.isActive === false ? ', desactivada' : ''})`).join(' · ') : <span className="text-lamp">Agrega tu primera cancha para recibir reservas</span>}
              </p>
            </Link>
          </li>))}</ul>
      )}
      {creating && <NewVenue onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
    </>
  );
}
export default function Page() { return <RequireAuth><Content /></RequireAuth>; }
