'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '../../_lib/api';
import { formatDayLong, formatMoney, formatTime, SPORTS } from '../../_lib/format';
import type { Booking, PaymentResult } from '../../_lib/types';
import { useQuery } from '../../_lib/use-query';
import { Countdown, ErrorBox, Loading, Notice, RequireAuth, StatusChip } from '../../_components/ui';

// Modo "simulado": el backend usa tokens de prueba. Modo "culqi": se tokeniza la tarjeta con Culqi (sin verificar contra el servicio real en esta entrega).
const MODE = process.env.NEXT_PUBLIC_PAYMENT_MODE ?? 'simulated';
const CULQI_KEY = process.env.NEXT_PUBLIC_CULQI_PUBLIC_KEY ?? '';

const TEST_CARDS = [
  { token: 'tkn_test_ok', label: 'Tarjeta aprobada' },
  { token: 'tkn_test_declined', label: 'Tarjeta rechazada' },
  { token: 'tkn_test_insufficient_funds', label: 'Fondos insuficientes' },
  { token: 'tkn_test_unavailable', label: 'Pasarela caída' },
];

function PayError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'No se pudo completar el pago.';
  if (e.status === 402) return `${e.message} No se hizo ningún cobro; puedes intentar con otra tarjeta.`;
  if (e.status === 409) return 'Esta reserva ya no se puede pagar (venció o fue cancelada).';
  if (e.status === 503) return 'La pasarela de pagos no responde. Revisa "Mis reservas" en unos minutos antes de reintentar, para no pagar dos veces.';
  return e.message;
}

function Content() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useQuery(async () => {
    const all = await api<Booking[]>('/bookings/mine');
    const b = all.find((x) => x.id === id);
    if (!b) throw new ApiError(404, 'No encontramos esta reserva.');
    return b;
  }, [id]);
  const [token, setToken] = useState(TEST_CARDS[0].token);
  const [card, setCard] = useState({ number: '4111111111111111', exp: '09/30', cvv: '123' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function pay() {
    if (!data) return;
    setBusy(true); setProblem('');
    try {
      let tokenId = token;
      if (MODE === 'culqi') {
        const [mm, yy] = card.exp.split('/');
        const res = await fetch('https://secure.culqi.com/v2/tokens', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CULQI_KEY}` },
          body: JSON.stringify({ card_number: card.number.replace(/\s/g, ''), cvv: card.cvv, expiration_month: mm, expiration_year: `20${yy}`, email: 'cliente@canchaya.test' }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.id) throw new ApiError(402, body.user_message ?? 'Tarjeta no válida.');
        tokenId = body.id;
      }
      await api<PaymentResult>(`/bookings/${data.id}/pay`, { method: 'POST', body: { tokenId } });
      reload();
    } catch (e) { setProblem(PayError(e)); }
    setBusy(false);
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const b = data!;
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/reservas" className="text-sm text-mute hover:text-chalk">‹ Mis reservas</Link>
      <h1 className="mt-2 font-display text-5xl font-extrabold leading-none tracking-wide">{b.status === 'confirmed' ? '¡Cancha reservada!' : b.status === 'pending' ? 'Paga para confirmar' : 'Reserva'}</h1>
      <div className="line-card mt-6 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-display text-2xl font-extrabold tracking-wide">{b.venue.name}</h2>
            <p className="text-mute">{b.court.name} · {SPORTS[b.court.sport]}</p></div>
          <StatusChip status={b.status} />
        </div>
        <p className="mt-4 cap-first">{formatDayLong(b.startsAt)}</p>
        <p className="num text-4xl text-lamp">{formatTime(b.startsAt)} – {formatTime(b.endsAt)}</p>
        <p className="mt-3 flex justify-between border-t pt-3"><span className="text-mute">Total</span><span className="num text-3xl">{formatMoney(b.totalPrice)}</span></p>
      </div>

      {b.status === 'pending' && b.expiresAt && (
        <section className="line-card mt-4 p-5" aria-label="Pago">
          <p className="text-mute">Tu hora está guardada por</p>
          <Countdown until={b.expiresAt} onExpire={reload} />
          {MODE === 'culqi' ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="label" htmlFor="num">Número de tarjeta</label>
                <input id="num" className="field num" inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} /></div>
              <div><label className="label" htmlFor="exp">Vence (MM/AA)</label>
                <input id="exp" className="field num" autoComplete="cc-exp" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} /></div>
              <div><label className="label" htmlFor="cvv">CVV</label>
                <input id="cvv" className="field num" inputMode="numeric" autoComplete="cc-csc" value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value })} /></div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="label" id="cards">Pago de prueba: elige qué pasa</p>
              <div role="radiogroup" aria-labelledby="cards" className="flex flex-wrap gap-2">
                {TEST_CARDS.map((c) => <button key={c.token} role="radio" aria-checked={token === c.token} className="chip" aria-pressed={token === c.token} onClick={() => setToken(c.token)}>{c.label}</button>)}
              </div>
              <p className="mt-2 text-sm text-mute">Modo demostración: no se cobra dinero real.</p>
            </div>
          )}
          {problem && <div className="mt-4"><Notice tone="error">{problem}</Notice></div>}
          <button className="btn-lamp mt-4 w-full" disabled={busy} onClick={pay}>{busy ? 'Procesando pago…' : `Pagar ${formatMoney(b.totalPrice)}`}</button>
        </section>
      )}
      {b.status === 'confirmed' && (
        <div className="mt-4 space-y-3"><Notice tone="ok">Pago aprobado. Tu cancha está confirmada.</Notice>
          <div className="flex flex-wrap gap-3"><Link className="btn-lamp" href="/reservas">Buscar jugadores desde mis reservas</Link><Link className="btn-line" href="/canchas">Seguir viendo canchas</Link></div></div>
      )}
      {(b.status === 'expired' || b.status === 'cancelled') && (
        <div className="mt-4 space-y-3"><Notice tone="info">{b.status === 'expired' ? 'El tiempo para pagar terminó y la hora se liberó.' : 'Esta reserva fue cancelada.'}</Notice>
          <Link className="btn-lamp" href={`/canchas/${b.venue.id}`}>Reservar otra hora</Link></div>
      )}
    </div>
  );
}
export default function Page() { return <RequireAuth><Content /></RequireAuth>; }
