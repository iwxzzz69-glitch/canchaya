import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'juan@correo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'MiClave1234' })
  @IsString()
  password!: string;
}
