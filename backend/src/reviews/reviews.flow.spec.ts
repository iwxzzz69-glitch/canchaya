import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Booking } from '../bookings/booking.entity';
import { createTestDatabase, destroyTestDatabase, hasDatabase, seedBasics } from '../testing/test-database';
import { Role } from '../users/role.enum';
import { Court } from '../venues/court.entity';
import { Venue } from '../venues/venue.entity';
import { VenuesService } from '../venues/venues.service';
import { Review } from './review.entity';
import { ReviewsService } from './reviews.service';

/** Reglas de reseñas contra PostgreSQL real (base propia `canchaya_test_reviews`). */
const describeDb = hasDatabase ? describe : describe.skip;
const DB = 'canchaya_test_reviews';

describeDb('Reseñas (PostgreSQL real)', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let reviews: ReviewsService;
  let venues: VenuesService;
  let players: AuthUser[];
  let courtId: string;
  let venueId: string;
  const admin: AuthUser = { id: '00000000-0000-4000-8000-0000000000aa', email: 'a@x.com', role: Role.Admin };
  let seq = 0;

  beforeAll(async () => {
    ds = await createTestDatabase(DB);
    const seed = await seedBasics(ds, 4);
    players = seed.players;
    courtId = seed.courtId;
    venueId = seed.venueId;
    reviews = new ReviewsService(ds.getRepository(Review), ds.getRepository(Booking), ds.getRepository(Venue));
    venues = new VenuesService(ds.getRepository(Venue), ds.getRepository(Court), ds.getRepository(Review));
  });

  afterAll(() => destroyTestDatabase(ds, DB));
  beforeEach(() => ds.query('TRUNCATE reviews, payments, bookings CASCADE'));

  /** Crea una reserva directamente en la base. `hoursFromNow` negativo = ya terminó. */
  async function booking(player: AuthUser, status: string, hoursFromNow = -48): Promise<string> {
    // Cada reserva cae en un día distinto para no chocar con la restricción de solapamiento.
    seq++;
    const dayShift = (hoursFromNow < 0 ? -seq : seq) * 86_400_000;
    const start = new Date(Date.now() + hoursFromNow * 3_600_000 + dayShift);
    const rows = await ds.query(
      `INSERT INTO bookings (court_id, player_id, starts_at, ends_at, total_price, status)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour', 80, $4) RETURNING id`,
      [courtId, player.id, start.toISOString(), status],
    );
    return rows[0].id;
  }

  it('el jugador reseña una reserva confirmada que ya terminó', async () => {
    const id = await booking(players[0], 'confirmed');
    const r = await reviews.create(players[0], id, { rating: 5, comment: '  Muy buena  ' });
    expect(r).toMatchObject({ bookingId: id, venueId, rating: 5, comment: 'Muy buena' });
  });

  it('el comentario es opcional', async () => {
    const id = await booking(players[0], 'confirmed');
    expect((await reviews.create(players[0], id, { rating: 3 })).comment).toBeNull();
  });

  it('no se puede reseñar la reserva de otro', async () => {
    const id = await booking(players[0], 'confirmed');
    await expect(reviews.create(players[1], id, { rating: 5 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reserva inexistente: 404', async () => {
    await expect(
      reviews.create(players[0], '00000000-0000-4000-8000-000000000000', { rating: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['pending', 'cancelled', 'expired'])('no se reseña una reserva %s', async (status) => {
    const id = await booking(players[0], status);
    await expect(reviews.create(players[0], id, { rating: 5 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('no se reseña una reserva que todavía no terminó', async () => {
    const id = await booking(players[0], 'confirmed', 48);
    await expect(reviews.create(players[0], id, { rating: 5 })).rejects.toThrow('cuando termine');
  });

  it('una sola reseña por reserva, incluso si llegan a la vez', async () => {
    const id = await booking(players[0], 'confirmed');
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => reviews.create(players[0], id, { rating: 4 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    expect(await ds.getRepository(Review).count()).toBe(1);
  });

  it('la base rechaza calificaciones fuera de 1 a 5 aunque se salte el servicio', async () => {
    const id = await booking(players[0], 'confirmed');
    for (const rating of [0, 6]) {
      await expect(
        ds.query(`INSERT INTO reviews (booking_id, venue_id, player_id, rating) VALUES ($1, $2, $3, $4)`, [
          id, venueId, players[0].id, rating,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  describe('listado y promedio', () => {
    beforeEach(async () => {
      for (const [i, rating] of [5, 4, 4].entries()) {
        await reviews.create(players[i], await booking(players[i], 'confirmed'), { rating, comment: `c${i}` });
      }
    });

    it('calcula promedio y total, y muestra solo el primer nombre', async () => {
      const list = await reviews.listForVenue(venueId);
      expect(list.total).toBe(3);
      expect(list.average).toBe(4.3);
      expect(list.data.map((d) => d.author).sort()).toEqual(['Jugador0', 'Jugador1', 'Jugador2']);
      expect(JSON.stringify(list)).not.toContain('Apellido');
      expect(JSON.stringify(list)).not.toContain('@test.com');
    });

    it('pagina', async () => {
      const list = await reviews.listForVenue(venueId, 2, 2);
      expect(list.data).toHaveLength(1);
      expect(list.total).toBe(3);
    });

    it('local inexistente: 404', async () => {
      await expect(reviews.listForVenue('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('la calificación aparece en la búsqueda y el detalle del local', async () => {
      const detail = await venues.findOne(venueId);
      expect(detail.rating).toEqual({ average: 4.3, count: 3 });
      const search = await venues.search({});
      expect(search.data[0].rating).toEqual({ average: 4.3, count: 3 });
    });

    it('un local sin reseñas tiene promedio null y cuenta 0', async () => {
      await ds.query('TRUNCATE reviews');
      expect((await venues.findOne(venueId)).rating).toEqual({ average: null, count: 0 });
    });
  });

  describe('borrar', () => {
    it('la autora la borra; el promedio se actualiza', async () => {
      const r = await reviews.create(players[0], await booking(players[0], 'confirmed'), { rating: 1 });
      await reviews.remove(players[0], r.id);
      expect((await venues.findOne(venueId)).rating.count).toBe(0);
    });

    it('un admin puede borrar cualquiera', async () => {
      const r = await reviews.create(players[0], await booking(players[0], 'confirmed'), { rating: 1 });
      await expect(reviews.remove(admin, r.id)).resolves.toBeUndefined();
    });

    it('otro jugador no puede borrarla', async () => {
      const r = await reviews.create(players[0], await booking(players[0], 'confirmed'), { rating: 1 });
      await expect(reviews.remove(players[1], r.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await ds.getRepository(Review).count()).toBe(1);
    });

    it('reseña inexistente: 404', async () => {
      await expect(reviews.remove(admin, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
