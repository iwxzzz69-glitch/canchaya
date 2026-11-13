import jwt from 'jsonwebtoken';
import { AuthUser, Role } from './types';

const ROLES: Role[] = ['player', 'owner', 'admin'];

/**
 * Valida el JWT que emite el monolito (mismo secreto, HS256). Devuelve null si no es válido.
 * Solo se acepta HS256: así nadie puede presentar un token con `alg: none` ni con otro algoritmo.
 */
export function verifyToken(token: unknown, secret: string): AuthUser | null {
  if (typeof token !== 'string' || !token || !secret) return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null) return null;
    const { sub, email, role } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || !sub) return null;
    if (typeof role !== 'string' || !ROLES.includes(role as Role)) return null;
    return { id: sub, email: typeof email === 'string' ? email : '', role: role as Role };
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match?.[1];
}
