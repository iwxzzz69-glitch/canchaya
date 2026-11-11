import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { PaymentsService } from '../payments/payments.service';
import { Role } from '../users/role.enum';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { BookingStatus } from './booking-status.enum';
import { Booking } from './booking.entity';
import { BookingsService } from './bookings.service';
import { localDateString, localInstant, parseLocalDate } from './local-time';

// Un instante futuro (en 3 días) a las `hour`:00 hora de Lima.
function futureSlot(hour: number): Date {
  const date = parseLocalDate(localDateString(new Date(Date.now() + 3 * 86_400_000)))!;
  return localInstant(date.year, date.month, date.day, hour);
}

const player: AuthUser = { id: 'player-1', email: 'p@x.com', role: Role.Player };
const stranger: AuthUser = { id: 'player-2', email: 'q@x.com', role: Role.Player };
const venueOwner: AuthUser = { id: 'owner-1', email: 'o@x.com', role: Role.Owner };
const admin: AuthUser = { id: 'admin-1', email: 'a@x.com', role: Role.Admin };

describe('BookingsService (reglas, sin base de datos)', () => {
  let bookings: {
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let courts: { findOne: jest.Mock };
  let payments: { refundForBooking: jest.Mock };
  let updateResult: { affected: number };
  let service: BookingsService;

  const court = { id: 'court-1', isActive: true, openHour: 8, closeHour: 23, pricePerHour: 80.5 };

  beforeEach(() => {
    updateResult = { affected: 1 };
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['update', 'set', 'where', 'andWhere']) qb[m] = jest.fn().mockReturnValue(qb);
    qb.execute = jest.fn(async () => updateResult);

    bookings = {
      create: jest.fn((b) => b),
      save: jest.fn(async (b) => ({ id: 'b-1', ...b })),
      query: jest.fn(async () => undefined),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(async () => ({ id: 'b-1' })),
      createQueryBuilder: jest.fn(() => qb),
    };
    courts = { findOne: jest.fn(async () => ({ ...court })) };
    payments = { refundForBooking: jest.fn(async () => 'none') };
    service = new BookingsService(
      bookings as unknown as Repository<Booking>,
      courts as unknown as Repository<Court>,
      {} as Repository<Venue>,
      payments as unknown as PaymentsService,
      new ConfigService({ BOOKING_HOLD_MINUTES: 10 }),
    );
  });

  describe('crear reserva', () => {
    const dto = (startsAt: Date, hours?: number) => ({
      courtId: 'court-1',
      startsAt: startsAt.toISOString(),
      hours,
    });

    it('crea una reserva pending con precio total y bloqueo de 10 minutos', async () => {
      const before = Date.now();
      const result = await service.create(player, dto(futureSlot(20), 2));

      expect(result.status).toBe(BookingStatus.Pending);
      expect(result.totalPrice).toBe(161); // 80.50 x 2 horas
      expect(result.playerId).toBe('player-1');
      expect(result.endsAt.getTime() - result.startsAt.getTime()).toBe(2 * 3_600_000);
      const hold = result.expiresAt!.getTime() - before;
      expect(hold).toBeGreaterThanOrEqual(10 * 60_000 - 50);
      expect(hold).toBeLessThan(10 * 60_000 + 5_000);
    });

    it('libera antes los bloqueos vencidos de ese rango', async () => {
      await service.create(player, dto(futureSlot(20)));
      expect(bookings.query).toHaveBeenCalledTimes(1);
      expect(bookings.query.mock.calls[0][1][0]).toBe('court-1');
    });

    it('rechaza una hora que no es en punto', async () => {
      const start = new Date(futureSlot(20).getTime() + 30 * 60_000);
      await expect(service.create(player, dto(start))).rejects.toBeInstanceOf(BadRequestException);
      expect(bookings.save).not.toHaveBeenCalled();
    });

    it('rechaza reservar en el pasado', async () => {
      const past = new Date(Date.now() - 3 * 3_600_000);
      past.setMinutes(0, 0, 0);
      await expect(service.create(player, dto(past))).rejects.toThrow('pasado');
    });

    it('responde 404 si la cancha no existe', async () => {
      courts.findOne.mockResolvedValue(null);
      await expect(service.create(player, dto(futureSlot(20)))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza una cancha desactivada', async () => {
      courts.findOne.mockResolvedValue({ ...court, isActive: false });
      await expect(service.create(player, dto(futureSlot(20)))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza empezar antes de abrir', async () => {
      await expect(service.create(player, dto(futureSlot(7)))).rejects.toThrow('atiende de 08:00 a 23:00');
    });

    it('rechaza terminar después de cerrar', async () => {
      await expect(service.create(player, dto(futureSlot(22), 2))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acepta terminar justo a la hora de cierre', async () => {
      await expect(service.create(player, dto(futureSlot(22), 1))).resolves.toBeDefined();
    });

    it('traduce la violación de la restricción de exclusión a 409', async () => {
      bookings.save.mockRejectedValue({ driverError: { code: '23P01' } });
      await expect(service.create(player, dto(futureSlot(20)))).rejects.toBeInstanceOf(ConflictException);
    });

    it('no oculta otros errores de base de datos', async () => {
      const boom = new Error('conexión perdida');
      bookings.save.mockRejectedValue(boom);
      await expect(service.create(player, dto(futureSlot(20)))).rejects.toBe(boom);
    });
  });

  describe('cancelar', () => {
    const booking = (over: Partial<Booking> & { startsInHours?: number }) => ({
      id: 'b-1',
      playerId: 'player-1',
      status: BookingStatus.Confirmed,
      expiresAt: null,
      startsAt: new Date(Date.now() + (over.startsInHours ?? 48) * 3_600_000),
      court: { venue: { ownerId: 'owner-1' } },
      ...over,
    });

    it('al cancelar pide el reembolso y lo informa en la respuesta', async () => {
      bookings.findOne.mockResolvedValue(booking({}));
      payments.refundForBooking.mockResolvedValue('refunded');
      await expect(service.cancel(player, 'b-1')).resolves.toMatchObject({ refund: 'refunded' });
      expect(payments.refundForBooking).toHaveBeenCalledWith('b-1');
    });

    it('si no tiene permiso, no se toca el reembolso', async () => {
      bookings.findOne.mockResolvedValue(booking({}));
      await expect(service.cancel(stranger, 'b-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(payments.refundForBooking).not.toHaveBeenCalled();
    });

    it('un tercero no puede cancelar', async () => {
      bookings.findOne.mockResolvedValue(booking({}));
      await expect(service.cancel(stranger, 'b-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('el jugador cancela con antelación', async () => {
      bookings.findOne.mockResolvedValue(booking({}));
      await expect(service.cancel(player, 'b-1')).resolves.toBeDefined();
    });

    it('el jugador no puede cancelar una reserva confirmada a menos de 2 horas', async () => {
      bookings.findOne.mockResolvedValue(booking({ startsInHours: 1 }));
      await expect(service.cancel(player, 'b-1')).rejects.toThrow('2 horas');
    });

    it('el jugador sí puede soltar un bloqueo sin pagar aunque falte poco', async () => {
      bookings.findOne.mockResolvedValue(
        booking({ startsInHours: 1, status: BookingStatus.Pending, expiresAt: new Date(Date.now() + 60_000) }),
      );
      await expect(service.cancel(player, 'b-1')).resolves.toBeDefined();
    });

    it('el dueño del local puede cancelar a última hora', async () => {
      bookings.findOne.mockResolvedValue(booking({ startsInHours: 1 }));
      await expect(service.cancel(venueOwner, 'b-1')).resolves.toBeDefined();
    });

    it('un admin puede cancelar siempre', async () => {
      bookings.findOne.mockResolvedValue(booking({ startsInHours: 1 }));
      await expect(service.cancel(admin, 'b-1')).resolves.toBeDefined();
    });

    it('no se cancela dos veces', async () => {
      bookings.findOne.mockResolvedValue(booking({ status: BookingStatus.Cancelled }));
      await expect(service.cancel(player, 'b-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('un bloqueo vencido cuenta como expirado y no se cancela', async () => {
      bookings.findOne.mockResolvedValue(
        booking({ status: BookingStatus.Pending, expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.cancel(player, 'b-1')).rejects.toThrow('expired');
    });
  });
});
