import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Sport } from '../sport.enum';

export class CreateVenueDto {
  @ApiProperty({ example: 'Complejo Los Olivos' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Canchas de grass sintético con estacionamiento' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 'Av. Larco 1234' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  address!: string;

  @ApiProperty({ example: 'Miraflores', description: 'Zona o distrito' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  zone!: string;

  @ApiPropertyOptional({ example: -12.1211 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: -77.0297 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class UpdateVenueDto extends PartialType(CreateVenueDto) {}

export class CreateCourtDto {
  @ApiProperty({ example: 'Cancha 1' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: Sport, example: Sport.Football })
  @IsEnum(Sport)
  sport!: Sport;

  @ApiProperty({ example: 80, description: 'Precio por hora en soles' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  pricePerHour!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCourtDto extends PartialType(CreateCourtDto) {}

export class SearchVenuesDto {
  @ApiPropertyOptional({ example: 'Miraflores' })
  @IsOptional()
  @IsString()
  zone?: string;

  @ApiPropertyOptional({ enum: Sport })
  @IsOptional()
  @IsEnum(Sport)
  sport?: Sport;

  @ApiPropertyOptional({ example: 100, description: 'Precio máximo por hora' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

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
