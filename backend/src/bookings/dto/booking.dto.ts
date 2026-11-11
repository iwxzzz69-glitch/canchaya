import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '3f0c2a5e-8f2b-4c55-9d0e-1c2d3e4f5a6b' })
  @IsUUID()
  courtId!: string;

  @ApiProperty({
    example: '2026-11-14T20:00:00-05:00',
    description: 'Inicio de la reserva, en hora en punto y con zona horaria (Z o ±hh:mm)',
  })
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'startsAt debe incluir zona horaria (Z o ±hh:mm)' })
  startsAt!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 3, description: 'Horas a reservar' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  hours?: number;
}

export class DateQueryDto {
  @ApiProperty({ example: '2026-11-14', description: 'Fecha local (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe tener el formato YYYY-MM-DD' })
  date!: string;
}

export class AgendaQueryDto {
  @ApiPropertyOptional({ example: '2026-11-14', description: 'Fecha local; sin ella, las próximas reservas' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe tener el formato YYYY-MM-DD' })
  date?: string;
}
