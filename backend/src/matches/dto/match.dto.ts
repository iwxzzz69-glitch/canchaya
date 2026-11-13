import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Sport } from '../../venues/sport.enum';
import { MatchLevel } from '../match-level.enum';

export class CreateMatchDto {
  @ApiProperty({ description: 'Reserva confirmada tuya para la que buscas jugadores' })
  @IsUUID()
  bookingId!: string;

  @ApiProperty({ minimum: 1, maximum: 20, description: 'Cuántos jugadores faltan (tú no cuentas)', example: 4 })
  @IsInt()
  @Min(1)
  @Max(20)
  spots!: number;

  @ApiPropertyOptional({ enum: MatchLevel, default: MatchLevel.Casual })
  @IsOptional()
  @IsEnum(MatchLevel)
  level?: MatchLevel;

  @ApiPropertyOptional({ maxLength: 300, example: 'Traer polo oscuro y claro' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class SearchMatchesDto {
  @ApiPropertyOptional({ enum: Sport })
  @IsOptional()
  @IsEnum(Sport)
  sport?: Sport;

  @ApiPropertyOptional({ enum: MatchLevel })
  @IsOptional()
  @IsEnum(MatchLevel)
  level?: MatchLevel;

  @ApiPropertyOptional({ example: 'Miraflores' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @ApiPropertyOptional({ example: '2026-11-20', description: 'Día local (hora de Lima)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe tener formato AAAA-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
