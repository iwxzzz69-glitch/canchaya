'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '../_lib/session';
import { Logo } from './Logo';

const LINKS = [
  { href: '/canchas', label: 'Canchas', icon: 'M3 6h18v12H3zM12 6v12M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z' },
  { href: '/partidos', label: 'Partidos', icon: 'M8 11a3 3 0 100-6 3 3 0 000 6zM16 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M14.5 14.5c3 0 5 1.6 5 4' },
  { href: '/reservas', label: 'Mis reservas', icon: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3' },
];

const active = (path: string, href: string) => path === href || path.startsWith(href + '/');

export function Header() {
  const path = usePathname();
  const { user, ready, logout } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b bg-night/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="CanchaYa, inicio"><Logo /></Link>
        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(path, l.href) ? 'page' : undefined}
              className={`rounded-lg px-4 py-2 transition ${active(path, l.href) ? 'bg-pitch-raised text-chalk' : 'text-mute hover:text-chalk'}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {!ready ? null : user ? (
            <>
              <span className="hidden max-w-[10rem] truncate text-sm text-mute sm:inline">{user.name.split(' ')[0]}</span>
              <button className="btn-quiet !min-h-[40px]" onClick={logout}>Salir</button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-quiet !min-h-[40px]">Ingresar</Link>
              <Link href="/registro" className="btn-lamp !min-h-[40px] !px-4 text-sm">Crear cuenta</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// En celular la navegación va abajo, al alcance del pulgar, como en una app.
export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 border-t bg-night/95 backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-3">
        {LINKS.map((l) => {
          const on = active(path, l.href);
          return (
            <li key={l.href}>
              <Link href={l.href} aria-current={on ? 'page' : undefined}
                className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-xs ${on ? 'text-lamp' : 'text-mute'}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={l.icon} />
                </svg>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
