import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../users/role.enum';
import { BookingsService } from './bookings.service';
import { AgendaQueryDto, CreateBookingDto, DateQueryDto } from './dto/booking.dto';

@ApiTags('bookings')
@Controller('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  // Crea la reserva en estado pending y bloquea el horario unos minutos mientras se paga
  // (el pago está en POST /bookings/:id/pay y es lo que la confirma).
  @Post()
  @Roles(Role.Player, Role.Owner)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get('mine')
  @Roles(Role.Player, Role.Owner)
  listMine(@CurrentUser() user: AuthUser) {
    return this.bookings.listMine(user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.Player, Role.Owner, Role.Admin)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(user, id);
  }
}

// Público: qué turnos de una cancha están libres en una fecha.
@ApiTags('courts')
@Controller('courts')
export class AvailabilityController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(':id/availability')
  availability(@Param('id', ParseUUIDPipe) id: string, @Query() query: DateQueryDto) {
    return this.bookings.availability(id, query.date);
  }
}

@ApiTags('venues')
@Controller('venues/:venueId/bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Owner, Role.Admin)
export class VenueBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  agenda(
    @CurrentUser() user: AuthUser,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Query() query: AgendaQueryDto,
  ) {
    return this.bookings.agenda(user, venueId, query.date);
  }
}
