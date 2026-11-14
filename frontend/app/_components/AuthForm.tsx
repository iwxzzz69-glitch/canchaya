'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError } from '../_lib/api';
import { useSession } from '../_lib/session';
import { Notice } from './ui';

function Form({ mode }: { mode: 'login' | 'registro' }) {
  const { login, register } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/canchas';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'player' | 'owner'>('player');
  const isLogin = mode === 'login';

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      if (isLogin) await login(String(f.get('email')), String(f.get('password')));
      else await register(String(f.get('name')).trim(), String(f.get('email')), String(f.get('password')), role);
      router.replace(role === 'owner' && !next ? '/panel' : safeNext);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo completar. Inténtalo de nuevo.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-5xl font-extrabold leading-none tracking-wide">{isLogin ? 'Ingresa a tu cuenta' : 'Crea tu cuenta'}</h1>
      <p className="mt-3 text-mute">{isLogin ? 'Para reservar, pagar y ver tus partidos.' : 'Es gratis. Con tu cuenta reservas canchas y te unes a partidos.'}</p>
      <form onSubmit={submit} className="line-card mt-6 space-y-4 p-6" noValidate={false}>
        {!isLogin && (
          <div><label className="label" htmlFor="name">Nombre</label>
            <input id="name" name="name" className="field" required minLength={2} maxLength={80} autoComplete="name" /></div>
        )}
        {!isLogin && (
          <div><span className="label" id="role">¿Cómo vas a usar CanchaYa?</span>
            <div role="radiogroup" aria-labelledby="role" className="flex flex-wrap gap-2">
              <button type="button" role="radio" aria-checked={role === 'player'} className="chip" aria-pressed={role === 'player'} onClick={() => setRole('player')}>Quiero jugar</button>
              <button type="button" role="radio" aria-checked={role === 'owner'} className="chip" aria-pressed={role === 'owner'} onClick={() => setRole('owner')}>Tengo canchas</button>
            </div></div>
        )}
        <div><label className="label" htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" className="field" required autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" className="field" required minLength={isLogin ? 1 : 8} maxLength={72}
            autoComplete={isLogin ? 'current-password' : 'new-password'} aria-describedby={isLogin ? undefined : 'pw-hint'} />
          {!isLogin && <p id="pw-hint" className="mt-1 text-sm text-mute">Mínimo 8 caracteres.</p>}</div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn-lamp w-full" disabled={busy}>{busy ? 'Un momento…' : isLogin ? 'Ingresar' : 'Crear cuenta'}</button>
      </form>
      <p className="mt-5 text-center text-mute">
        {isLogin ? '¿Primera vez? ' : '¿Ya tienes cuenta? '}
        <Link className="text-lamp underline underline-offset-4" href={`${isLogin ? '/registro' : '/login'}${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
          {isLogin ? 'Crea tu cuenta' : 'Ingresa'}
        </Link>
      </p>
    </div>
  );
}
export function AuthForm({ mode }: { mode: 'login' | 'registro' }) {
  return <Suspense><Form mode={mode} /></Suspense>;
}
