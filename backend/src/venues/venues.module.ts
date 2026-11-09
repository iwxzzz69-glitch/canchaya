import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Court } from './court.entity';
import { Venue } from './venue.entity';
import { CourtsController, VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';

@Module({
  imports: [TypeOrmModule.forFeature([Venue, Court]), AuthModule],
  controllers: [VenuesController, CourtsController],
  providers: [VenuesService],
})
export class VenuesModule {}
