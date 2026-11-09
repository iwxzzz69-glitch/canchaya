import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './auth-user';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('El correo ya está registrado');
    }
    const user = await this.users.create({
      email: dto.email,
      name: dto.name,
      role: dto.role ?? Role.Player,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
    });
    return this.buildSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    // Mismo mensaje para correo inexistente y clave errónea: no revela qué cuentas existen.
    const valid = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.buildSession(user);
  }

  private async buildSession(user: User) {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
