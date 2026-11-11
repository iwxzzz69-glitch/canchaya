import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { PG_EXCLUSION_VIOLATION, pgErrorCode } from '../common/db-errors';
import { PaymentsService } from '../payments/payments.service';
import { Role } from '../users/role.enum';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { BookingStatus } from './booking-status.enum';
import { Booking } from './booking.entity';
import { CreateBookingDto } from './dto/booking.dto';
import { addHours, isOnTheHour, localHour, localInstant, parseLocalDate } from './local-time';

const MIN_CANCEL_HOURS = 2;
const DEFAULT_HOLD_MINUTES = 10;
const SWEEP_INTERVAL_MS = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private readonly holdMinutes: number;
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Court) private readonly courts: Repository<Court>,
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
    private readonly payments: PaymentsService,
    config: ConfigService,
  ) {
    const configured = Number(config.get('BOOKING_HOLD_MINUTES'));
    this.holdMinutes = configured > 0 ? configured : DEFAULT_HOLD_MINUTES;
  }

  // Limpieza periódica de bloqueos vencidos. No es necesaria para la corrección (las consultas
  // y la creación ya ignoran los bloqueos vencidos); solo mantiene la tabla ordenada.
  onModuleInit() {
    this.sweepTimer = setInterval(() => {
      this.expireAllStaleHolds().catch((e) => this.logger.warn(`No se pudo limpiar bloqueos: ${e}`));
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private expireAllStaleHolds() {
    return this.bookings.query(
      `UPDATE bookings SET status = 'expired', updated_at = now()
       WHERE status = 'pending' AND expires_at <= now()`,
    );
  }

  // Libera, solo para este rango, los bloqueos vencidos que aún figuran como pending.
  private expireStaleHolds(courtId: string, from: Date, to: Date) {
    return this.bookings.query(
      `UPDATE bookings SET status = 'expired', updated_at = now()
       WHERE court_id = $1 AND status = 'pending' AND expires_at <= now()
         AND starts_at < $3 AND ends_at > $2`,
      [courtId, from, to],
    );
  }

  // Un pending cuyo bloqueo venció cuenta como expired aunque la limpieza aún no haya pasado.
  private effectiveStatus(b: Pick<Booking, 'status' | 'expiresAt'>): BookingStatus {
    if (b.status === BookingStatus.Pending && b.expiresAt && b.expiresAt.getTime() <= Date.now()) {
      return BookingStatus.Expired;
    }
    return b.status;
  }

  async create(user: AuthUser, dto: CreateBookingDto) {
    const startsAt = new Date(dto.startsAt);
    const hours = dto.hours ?? 1;

    if (!isOnTheHour(startsAt)) {
      throw new BadRequestException('La reserva debe empezar en una hora en punto');
    }
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('No se puede reservar en el pasado');
    }

    const court = await this.courts.findOne({ where: { id: dto.courtId } });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    if (!court.isActive) throw new BadRequestException('La cancha no está disponible');

    const startHour = localHour(startsAt);
    if (startHour < court.openHour || startHour + hours > court.closeHour) {
      throw new BadRequestException(
        `Esta cancha atiende de ${pad(court.openHour)}:00 a ${pad(court.closeHour)}:00 (hora de Lima)`,
      );
    }

    const endsAt = addHours(startsAt, hours);
    await this.expireStaleHolds(court.id, startsAt, endsAt);

    const booking = this.bookings.create({
      courtId: court.id,
      playerId: user.id,
      startsAt,
      endsAt,
      status: BookingStatus.Pending,
      totalPrice: Math.round(court.pricePerHour * 100 * hours) / 100,
      expiresAt: new Date(Date.now() + this.holdMinutes * 60_000),
    });

    // No hay "consultar y luego insertar": se inserta directamente y es la restricción de
    // exclusión de PostgreSQL la que decide quién gana si dos peticiones llegan a la vez.
    try {
      return await this.bookings.save(booking);
    } catch (error) {
      if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
        throw new ConflictException('Ese horario ya no está disponible');
      }
      throw error;
    }
  }

  async availability(courtId: string, date: string) {
    const parsed = parseLocalDate(date);
    if (!parsed) throw new BadRequestException('La fecha no es válida (usa YYYY-MM-DD)');

    const court = await this.courts.findOne({ where: { id: courtId } });
    if (!court) throw new NotFoundException('Cancha no encontrada');

    const { year, month, day } = parsed;
    const dayStart = localInstant(year, month, day, court.openHour);
    const dayEnd = localInstant(year, month, day, court.closeHour);

    const busy = await this.bookings
      .createQueryBuilder('b')
      .where('b.courtId = :courtId', { courtId })
      .andWhere('b.startsAt < :dayEnd AND b.endsAt > :dayStart', { dayStart, dayEnd })
      .andWhere(
        new Brackets((q) =>
          q
            .where('b.status = :confirmed', { confirmed: BookingStatus.Confirmed })
            .orWhere('b.status = :pending AND b.expiresAt > now()', { pending: BookingStatus.Pending }),
        ),
      )
      .getMany();

    const now = Date.now();
    const slots = [];
    for (let hour = court.openHour; hour < court.closeHour; hour++) {
      const start = localInstant(year, month, day, hour);
      const end = addHours(start, 1);
      const taken = busy.some((b) => b.startsAt < end && b.endsAt > start);
      slots.push({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        available: !taken && start.getTime() > now,
      });
    }

    return {
      courtId: court.id,
      date,
      timezone: 'America/Lima',
      pricePerHour: court.pricePerHour,
      slots,
    };
  }

  async listMine(user: AuthUser) {
    const rows = await this.bookings.find({
      where: { playerId: user.id },
      relations: { court: { venue: true } },
      order: { startsAt: 'DESC' },
    });
    return rows.map((b) => ({
      id: b.id,
      status: this.effectiveStatus(b),
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      totalPrice: b.totalPrice,
      expiresAt: b.expiresAt,
      court: { id: b.court.id, name: b.court.name, sport: b.court.sport },
      venue: {
        id: b.court.venue.id,
        name: b.court.venue.name,
        address: b.court.venue.address,
        zone: b.court.venue.zone,
      },
    }));
  }

  // Agenda del local: solo el dueño del local (o un admin).
  async agenda(user: AuthUser, venueId: string, date?: string) {
    const venue = await this.venues.findOne({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Local no encontrado');
    if (user.role !== Role.Admin && venue.ownerId !== user.id) {
      throw new ForbiddenException('Este local no te pertenece');
    }

    const qb = this.bookings
      .createQueryBuilder('b')
      .innerJoinAndSelect('b.court', 'court')
      .innerJoin('b.player', 'player')
      .addSelect(['player.id', 'player.name'])
      .where('court.venueId = :venueId', { venueId })
      .andWhere(
        new Brackets((q) =>
          q
            .where('b.status = :confirmed', { confirmed: BookingStatus.Confirmed })
            .orWhere('b.status = :pending AND b.expiresAt > now()', { pending: BookingStatus.Pending }),
        ),
      );

    if (date) {
      const parsed = parseLocalDate(date);
      if (!parsed) throw new BadRequestException('La fecha no es válida (usa YYYY-MM-DD)');
      const from = localInstant(parsed.year, parsed.month, parsed.day, 0);
      const to = localInstant(parsed.year, parsed.month, parsed.day + 1, 0);
      qb.andWhere('b.startsAt >= :from AND b.startsAt < :to', { from, to });
    } else {
      qb.andWhere('b.endsAt > now()');
    }

    return qb.orderBy('b.startsAt', 'ASC').getMany();
  }

  // La confirmación ya no es un endpoint: la hace el pago aprobado (ver PaymentsService).

  async cancel(user: AuthUser, id: string) {
    const booking = await this.bookings.findOne({
      where: { id },
      relations: { court: { venue: true } },
    });
    if (!booking) throw new NotFoundException('Reserva no encontrada');

    const isPlayer = booking.playerId === user.id;
    const privileged = user.role === Role.Admin || booking.court.venue.ownerId === user.id;
    if (!isPlayer && !privileged) throw new ForbiddenException('No puedes cancelar esta reserva');

    const status = this.effectiveStatus(booking);
    if (status !== BookingStatus.Pending && status !== BookingStatus.Confirmed) {
      throw new ConflictException(`La reserva ya está ${status}`);
    }

    // El jugador solo cancela una reserva confirmada con antelación; soltar un bloqueo sin pagar
    // es libre, y el dueño o un admin pueden cancelar siempre.
    const tooLate = booking.startsAt.getTime() - Date.now() < MIN_CANCEL_HOURS * 3_600_000;
    if (!privileged && status === BookingStatus.Confirmed && tooLate) {
      throw new ConflictException(`Solo puedes cancelar hasta ${MIN_CANCEL_HOURS} horas antes del inicio`);
    }

    const result = await this.bookings
      .createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.Cancelled, expiresAt: null })
      .where('id = :id', { id })
      .andWhere('status IN (:...active)', {
        active: [BookingStatus.Pending, BookingStatus.Confirmed],
      })
      .execute();

    if (!result.affected) throw new ConflictException('La reserva cambió de estado, vuelve a intentarlo');

    // Si estaba pagada se devuelve el dinero completo. La reserva ya quedó cancelada pase lo que
    // pase: si la devolución falla queda registrada como refund_failed y un admin la reintenta.
    const refund = await this.payments.refundForBooking(id);
    const cancelled = await this.bookings.findOneOrFail({ where: { id } });
    return { ...cancelled, refund };
  }
}
