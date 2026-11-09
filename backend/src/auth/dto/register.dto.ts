import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../users/role.enum';

export class RegisterDto {
  @ApiProperty({ example: 'juan@correo.com' })
  @IsEmail()
  email!: string;

  // bcrypt solo usa los primeros 72 bytes, por eso el máximo.
  @ApiProperty({ example: 'MiClave1234', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  // El rol admin no se puede elegir al registrarse.
  @ApiPropertyOptional({ enum: [Role.Player, Role.Owner], default: Role.Player })
  @IsOptional()
  @IsIn([Role.Player, Role.Owner])
  role?: Role.Player | Role.Owner;
}
