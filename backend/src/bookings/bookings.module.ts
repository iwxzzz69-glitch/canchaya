import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { Booking } from './booking.entity';
import {
  AvailabilityController,
  BookingsController,
  VenueBookingsController,
} from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Court, Venue]), AuthModule, PaymentsModule],
  controllers: [BookingsController, AvailabilityController, VenueBookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
