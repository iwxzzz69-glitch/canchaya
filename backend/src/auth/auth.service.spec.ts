import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let users: jest.Mocked<Pick<UsersService, 'findByEmail' | 'create'>>;
  let jwt: JwtService;
  let service: AuthService;

  beforeEach(() => {
    users = { findByEmail: jest.fn(), create: jest.fn() };
    jwt = new JwtService({ secret: 'secreto-de-prueba' });
    service = new AuthService(users as unknown as UsersService, jwt);
  });

  const userFixture = async (password = 'MiClave1234'): Promise<User> =>
    ({
      id: 'u-1',
      email: 'juan@correo.com',
      name: 'Juan',
      role: Role.Player,
      passwordHash: await bcrypt.hash(password, 4),
    }) as User;

  describe('register', () => {
    it('guarda la clave cifrada y devuelve un token con sub y rol', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockImplementation(async (data) => ({ id: 'u-1', ...data }) as User);

      const result = await service.register({
        email: 'juan@correo.com',
        password: 'MiClave1234',
        name: 'Juan',
        role: Role.Owner,
      });

      const saved = users.create.mock.calls[0][0];
      expect(saved.passwordHash).not.toBe('MiClave1234');
      expect(await bcrypt.compare('MiClave1234', saved.passwordHash)).toBe(true);

      const payload = jwt.verify(result.accessToken);
      expect(payload).toMatchObject({ sub: 'u-1', role: Role.Owner });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('usa el rol player por defecto', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockImplementation(async (data) => ({ id: 'u-1', ...data }) as User);

      await service.register({ email: 'a@b.com', password: 'MiClave1234', name: 'Ana' });

      expect(users.create.mock.calls[0][0].role).toBe(Role.Player);
    });

    it('rechaza un correo ya registrado', async () => {
      users.findByEmail.mockResolvedValue(await userFixture());

      await expect(
        service.register({ email: 'juan@correo.com', password: 'MiClave1234', name: 'Juan' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('devuelve un token con credenciales correctas', async () => {
      users.findByEmail.mockResolvedValue(await userFixture());

      const result = await service.login({ email: 'juan@correo.com', password: 'MiClave1234' });

      expect(jwt.verify(result.accessToken)).toMatchObject({ sub: 'u-1', role: Role.Player });
    });

    it('rechaza una clave incorrecta', async () => {
      users.findByEmail.mockResolvedValue(await userFixture());

      await expect(
        service.login({ email: 'juan@correo.com', password: 'otra-clave' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza un correo inexistente con el mismo mensaje', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nadie@correo.com', password: 'MiClave1234' }),
      ).rejects.toThrow('Credenciales inválidas');
    });
  });
});
