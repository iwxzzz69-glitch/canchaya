import { Role } from '../users/role.enum';

// Lo que el JWT lleva dentro y lo que los guards dejan en request.user.
// El chat-service lee `sub` (id del usuario) del mismo token.
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}
