import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../users/role.enum';
import { RolesGuard } from './roles.guard';

const contextWith = (user: unknown): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const build = (required: Role[] | undefined) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
    return new RolesGuard(reflector as unknown as Reflector);
  };

  it('deja pasar si la ruta no exige roles', () => {
    expect(build(undefined).canActivate(contextWith({ role: Role.Player }))).toBe(true);
  });

  it('deja pasar si el usuario tiene uno de los roles exigidos', () => {
    const guard = build([Role.Owner, Role.Admin]);
    expect(guard.canActivate(contextWith({ role: Role.Owner }))).toBe(true);
  });

  it('prohíbe a un jugador en una ruta de dueños', () => {
    const guard = build([Role.Owner]);
    expect(() => guard.canActivate(contextWith({ role: Role.Player }))).toThrow(ForbiddenException);
  });

  it('prohíbe si no hay usuario autenticado', () => {
    const guard = build([Role.Owner]);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
