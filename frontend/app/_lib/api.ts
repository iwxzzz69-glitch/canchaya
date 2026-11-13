import type { Session } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const KEY = 'canchaya.session';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// El token vive en localStorage: simple para una demo. En producción convendría una cookie httpOnly.
export const sessionStore = {
  read(): Session | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  write(session: Session | null) {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch {
      /* modo privado: la sesión dura lo que dure la pestaña */
    }
  },
};

function messageOf(body: unknown, fallback: string): string {
  const m = (body as { message?: string | string[] } | null)?.message;
  return Array.isArray(m) ? m.join('. ') : m ?? fallback;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const session = sessionStore.read();
  if (session && opts.auth !== false) headers.Authorization = `Bearer ${session.accessToken}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* respuesta sin cuerpo JSON */ }
  if (res.status === 401 && session) {
    // La sesión venció: se limpia y la pantalla pedirá iniciar sesión de nuevo.
    sessionStore.write(null);
    window.dispatchEvent(new Event('canchaya:session'));
  }
  if (!res.ok) {
    throw new ApiError(res.status, messageOf(json, 'Algo salió mal. Inténtalo de nuevo.'), (json as { code?: string } | null)?.code);
  }
  return json as T;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
