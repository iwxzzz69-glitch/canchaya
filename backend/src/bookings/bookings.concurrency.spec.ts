import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { PG_EXCLUSION_VIOLATION, pgErrorCode } from '../common/db-errors';
import { PaymentsService } from '../payments/payments.service';
import {
  createTestDatabase,
  destroyTestDatabase,
  hasDatabase,
  seedBasics,
  slot,
} from '../testing/test-database';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { localDateString } from './local-time';
import { BookingStatus } from './booking-status.enum';
import { Booking } from './booking.entity';
import { BookingsService } from './bookings.service';

/**
 * Pruebas de integración contra PostgreSQL real: demuestran que no se puede reservar dos
 * veces el mismo horario aunque lleguen decenas de peticiones a la vez.
 * Usan su propia base `canchaya_test_bookings`; sin DATABASE_URL se omiten.
 */
const describeDb = hasDatabase ? describe : describe.skip;
const DB = 'canchaya_test_bookings';

describeDb('Reservas concurrentes (PostgreSQL real)', () => {
  jest.setTimeout(60_000);

  const PLAYER_COUNT = 20;
  let ds: DataSource;
  let service: BookingsService;
  let courtId: string;
  let players: AuthUser[];

  beforeAll(async () => {
    ds = await createTestDatabase(DB);
    const seed = await seedBasics(ds, PLAYER_COUNT);
    courtId = seed.courtId;
    players = seed.players;

    // Estas pruebas no cobran: el pago tiene sus propios tests (payments.flow.spec.ts).
    const noPayments = { refundForBooking: async () => 'none' } as unknown as PaymentsService;
    service = new BookingsService(
      ds.getRepository(Booking),
      ds.getRepository(Court),
      ds.getRepository(Venue),
      noPayments,
      new ConfigService({ BOOKING_HOLD_MINUTES: 10 }),
    );
  });

  afterAll(() => destroyTestDatabase(ds, DB));

  beforeEach(async () => {
    await ds.query('TRUNCATE payments, bookings CASCADE');
  });

  const activeCount = async (startsAt: string) =>
    Number(
      (
        await ds.query(
          `SELECT count(*) FROM bookings WHERE court_id = $1 AND starts_at = $2 AND status IN ('pending','confirmed')`,
          [courtId, startsAt],
        )
      )[0].count,
    );

  const confirmDirectly = (id: string) =>
    ds.query(`UPDATE bookings SET status = 'confirmed', expires_at = NULL WHERE id = $1`, [id]);

  it(`con ${PLAYER_COUNT} peticiones simultáneas por el mismo horario, solo una gana`, async () => {
    const startsAt = slot(20);

    const results = await Promise.allSettled(
      players.map((p) => service.create(p, { courtId, startsAt })),
    );

    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(PLAYER_COUNT - 1);
    // Los perdedores reciben un 409 limpio, no un error interno de base de datos.
    for (const loser of losers) expect(loser.reason).toBeInstanceOf(ConflictException);
    expect(await activeCount(startsAt)).toBe(1);
  });

  it('repite la carrera varias veces seguidas sin que nunca ganen dos', async () => {
    for (let round = 0; round < 5; round++) {
      const startsAt = slot(9 + round);
      const results = await Promise.allSettled(
        players.map((p) => service.create(p, { courtId, startsAt })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await activeCount(startsAt)).toBe(1);
    }
  });

  it('peticiones simultáneas a horarios distintos tienen éxito todas', async () => {
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    const results = await Promise.allSettled(
      hours.map((h, i) => service.create(players[i], { courtId, startsAt: slot(h) })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(hours.length);
  });

  it('una reserva de varias horas bloquea los turnos que cubre, pero no los contiguos', async () => {
    await service.create(players[0], { courtId, startsAt: slot(20), hours: 2 }); // 20:00-22:00

    await expect(service.create(players[1], { courtId, startsAt: slot(21) })).rejects.toBeInstanceOf(
      ConflictException,
    ); // se pisa con el segundo tramo
    await expect(
      service.create(players[2], { courtId, startsAt: slot(19), hours: 2 }), // 19:00-21:00
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(service.create(players[3], { courtId, startsAt: slot(22) })).resolves.toBeDefined(); // 22-23
    await expect(service.create(players[4], { courtId, startsAt: slot(19) })).resolves.toBeDefined(); // 19-20
  });

  it('ante solapamientos parciales simultáneos nunca quedan dos reservas pisadas', async () => {
    // 18-20, 19-21 y 20-22 en paralelo: 19-21 pisa a las otras dos; 18-20 y 20-22 son compatibles.
    const attempts = [18, 19, 20].map((h, i) =>
      service.create(players[i], { courtId, startsAt: slot(h), hours: 2 }),
    );
    const results = await Promise.allSettled(attempts);

    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    const overlappingPairs = await ds.query(
      `SELECT count(*) FROM bookings a JOIN bookings b
         ON a.id < b.id AND a.court_id = b.court_id
        AND tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)
      WHERE a.status IN ('pending','confirmed') AND b.status IN ('pending','confirmed')`,
    );
    expect(Number(overlappingPairs[0].count)).toBe(0);
  });

  it('una reserva cancelada libera el horario', async () => {
    const startsAt = slot(20);
    const first = await service.create(players[0], { courtId, startsAt });
    await expect(service.create(players[1], { courtId, startsAt })).rejects.toBeInstanceOf(ConflictException);

    await service.cancel(players[0], first.id);

    await expect(service.create(players[1], { courtId, startsAt })).resolves.toBeDefined();
  });

  it('un bloqueo vencido no bloquea el horario y queda marcado como expirado', async () => {
    const startsAt = slot(20);
    // Bloqueo viejo: el jugador nunca pagó y su plazo ya pasó.
    await ds.query(
      `INSERT INTO bookings (court_id, player_id, starts_at, ends_at, total_price, status, expires_at)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour', 80, 'pending', now() - interval '5 minutes')`,
      [courtId, players[0].id, startsAt],
    );

    await expect(service.create(players[1], { courtId, startsAt })).resolves.toBeDefined();

    const old = await ds.query(`SELECT status FROM bookings WHERE player_id = $1`, [players[0].id]);
    expect(old[0].status).toBe(BookingStatus.Expired);
  });

  it('con un bloqueo vencido y muchas peticiones a la vez, sigue ganando una sola', async () => {
    const startsAt = slot(20);
    await ds.query(
      `INSERT INTO bookings (court_id, player_id, starts_at, ends_at, total_price, status, expires_at)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour', 80, 'pending', now() - interval '1 minute')`,
      [courtId, players[0].id, startsAt],
    );

    const results = await Promise.allSettled(
      players.slice(1).map((p) => service.create(p, { courtId, startsAt })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await activeCount(startsAt)).toBe(1);
  });

  it('un bloqueo vigente sí bloquea el horario', async () => {
    const startsAt = slot(20);
    await service.create(players[0], { courtId, startsAt });
    await expect(service.create(players[1], { courtId, startsAt })).rejects.toBeInstanceOf(ConflictException);
  });

  it('la disponibilidad refleja reservas, bloqueos vigentes y bloqueos vencidos', async () => {
    const date = localDateString(new Date(slot(12)));
    const confirmed = await service.create(players[0], { courtId, startsAt: slot(12) });
    await confirmDirectly(confirmed.id);
    await service.create(players[1], { courtId, startsAt: slot(13) }); // bloqueo vigente
    await ds.query(
      `INSERT INTO bookings (court_id, player_id, starts_at, ends_at, total_price, status, expires_at)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour', 80, 'pending', now() - interval '1 minute')`,
      [courtId, players[2].id, slot(14)],
    ); // bloqueo vencido

    const { slots } = await service.availability(courtId, date);
    const byStart = new Map(slots.map((s) => [s.startsAt, s.available]));

    expect(byStart.get(slot(12))).toBe(false); // confirmada
    expect(byStart.get(slot(13))).toBe(false); // bloqueada mientras paga
    expect(byStart.get(slot(14))).toBe(true); // el bloqueo venció
    expect(byStart.get(slot(15))).toBe(true); // nunca reservada
    expect(slots).toHaveLength(15); // 08:00 a 23:00
  });

  it('la base de datos rechaza el solapamiento aunque se salte el servicio', async () => {
    const startsAt = slot(20);
    await service.create(players[0], { courtId, startsAt });

    // INSERT directo, sin pasar por la aplicación: la restricción de exclusión lo frena igual.
    const attempt = ds.query(
      `INSERT INTO bookings (court_id, player_id, starts_at, ends_at, total_price, status)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour', 80, 'confirmed')`,
      [courtId, players[1].id, startsAt],
    );

    const error = await attempt.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgErrorCode(error)).toBe(PG_EXCLUSION_VIOLATION);
  });
});
