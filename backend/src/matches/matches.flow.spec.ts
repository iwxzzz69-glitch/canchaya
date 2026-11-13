import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Booking } from '../bookings/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { createTestDatabase, destroyTestDatabase, hasDatabase, seedBasics, slot } from '../testing/test-database';
import { Role } from '../users/role.enum';
import { Court } from '../venues/court.entity';
import { Sport } from '../venues/sport.enum';
import { Venue } from '../venues/venue.entity';
import { MatchLevel } from './match-level.enum';
import { MatchStatus } from './match-status.enum';
import { MatchesService } from './matches.service';

/** Partidos abiertos contra PostgreSQL real (base propia `canchaya_test_matches`). */
const describeDb = hasDatabase ? describe : describe.skip;
const DB = 'canchaya_test_matches';

describeDb('Partidos abiertos (PostgreSQL real)', () => {
  jest.setTimeout(90_000);

  let ds: DataSource;
  let matches: MatchesService;
  let bookings: BookingsService;
  let players: AuthUser[];
  let courtId: string;
  let venueId: string;
  let owner: AuthUser;
  const admin: AuthUser = { id: '00000000-0000-4000-8000-0000000000aa', email: 'a@x.com', role: Role.Admin };

  beforeAll(async () => {
    ds = await createTestDatabase(DB);
    const seed = await seedBasics(ds, 25);
    players = seed.players;
    courtId = seed.courtId;
    venueId = seed.venueId;
    owner = seed.owner;
    matches = new MatchesService(ds);
    const noPayments = { refundForBooking: async () => 'none' } as unknown as PaymentsService;
    bookings = new BookingsService(
      ds.getRepository(Booking),
      ds.getRepository(Court),
      ds.getRepository(Venue),
      noPayments,
      new ConfigService({ BOOKING_HOLD_MINUTES: 10 }),
    );
  });

  afterAll(() => destroyTestDatabase(ds, DB));
  beforeEach(() => ds.query('TRUNCATE outbox_events, match_players, matches, payments, bookings CASCADE'));

  let hour = 8;
  /** Reserva directa en la base, en un horario distinto cada vez. */
  async function booking(player: AuthUser, status = 'confirmed', cId = courtId, daysAhead = 3): Promise<string> {
    const h = 8 + (hour++ % 14);
    const rows = await ds.query(
      `INSERT INTO bookings (court_id, player_id, starts_at, ends_at, total_price, status)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour', 80, $4) RETURNING id`,
      [cId, player.id, slot(h, daysAhead), status],
    );
    return rows[0].id;
  }
  const open = async (organizer: AuthUser, spots = 4, extra: Record<string, unknown> = {}) =>
    matches.open(organizer, { bookingId: await booking(organizer), spots, ...extra });
  const row = async (id: string) => (await ds.query('SELECT * FROM matches WHERE id = $1', [id]))[0];
  const rowsOf = async (id: string) => Number((await ds.query('SELECT count(*) FROM match_players WHERE match_id = $1', [id]))[0].count);

  describe('abrir un partido', () => {
    it('con una reserva confirmada propia', async () => {
      const m = await open(players[0], 4, { level: MatchLevel.Intermediate, notes: '  Traer polo oscuro ' });
      expect(m).toMatchObject({
        status: 'open', level: 'intermediate', notes: 'Traer polo oscuro', organizer: 'Jugador0', sport: 'football',
        spotsTotal: 4, spotsTaken: 0, spotsLeft: 4, suggestedPricePerPlayer: 16, players: [],
      });
      expect(m.venue).toMatchObject({ name: 'Local', zone: 'Miraflores' });
      expect(JSON.stringify(m)).not.toContain('@test.com'); // nunca correos
      expect(JSON.stringify(m)).not.toContain('Apellido'); // solo el primer nombre
    });

    it.each(['pending', 'cancelled', 'expired'])('una reserva %s no sirve', async (status) => {
      const id = await booking(players[0], status);
      await expect(matches.open(players[0], { bookingId: id, spots: 3 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('no se abre con la reserva de otro', async () => {
      const id = await booking(players[0]);
      await expect(matches.open(players[1], { bookingId: id, spots: 3 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reserva inexistente: 404', async () => {
      await expect(
        matches.open(players[0], { bookingId: '00000000-0000-4000-8000-000000000000', spots: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una reserva que ya empezó no sirve', async () => {
      const id = await booking(players[0]);
      await ds.query(`UPDATE bookings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      await expect(matches.open(players[0], { bookingId: id, spots: 3 })).rejects.toThrow('ya empezó');
    });

    it('un solo partido por reserva, incluso si llegan a la vez', async () => {
      const id = await booking(players[0]);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => matches.open(players[0], { bookingId: id, spots: 3 })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
      expect(Number((await ds.query('SELECT count(*) FROM matches'))[0].count)).toBe(1);
    });
  });

  describe('unirse', () => {
    it('ocupa un lugar y aparece en la lista de jugadores', async () => {
      const m = await open(players[0], 3);
      const joined = await matches.join(players[1], m.id);
      expect(joined).toMatchObject({ spotsTaken: 1, spotsLeft: 2 });
      expect(joined.players.map((p) => p.name)).toEqual(['Jugador1']);
    });

    it('el organizador no puede unirse a su propio partido', async () => {
      const m = await open(players[0], 3);
      await expect(matches.join(players[0], m.id)).rejects.toThrow('organizador');
      expect((await row(m.id)).spots_taken).toBe(0);
    });

    it('no se puede unir dos veces y el cupo no cambia', async () => {
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      await expect(matches.join(players[1], m.id)).rejects.toThrow('Ya estás');
      expect((await row(m.id)).spots_taken).toBe(1);
      expect(await rowsOf(m.id)).toBe(1);
    });

    it('un partido completo responde 409', async () => {
      const m = await open(players[0], 2);
      await matches.join(players[1], m.id);
      await matches.join(players[2], m.id);
      await expect(matches.join(players[3], m.id)).rejects.toThrow('completo');
      expect(await rowsOf(m.id)).toBe(2);
    });

    it('un partido inexistente responde 404', async () => {
      await expect(matches.join(players[1], '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('un partido que ya empezó responde 409', async () => {
      const m = await open(players[0], 3);
      await ds.query(
        `UPDATE bookings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = (SELECT booking_id FROM matches WHERE id = $1)`,
        [m.id],
      );
      await expect(matches.join(players[1], m.id)).rejects.toThrow('ya empezó');
      expect(await rowsOf(m.id)).toBe(0); // el INSERT se deshizo junto con el intento
    });
  });

  describe('concurrencia: nunca más jugadores que lugares', () => {
    it('20 personas por 5 lugares: entran exactamente 5', async () => {
      const m = await open(players[0], 5);
      const results = await Promise.allSettled(players.slice(1, 21).map((p) => matches.join(p, m.id)));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      const losers = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(losers).toHaveLength(15);
      for (const l of losers) expect(l.reason).toBeInstanceOf(ConflictException); // 409 limpio, no un error de base de datos
      expect((await row(m.id)).spots_taken).toBe(5);
      expect(await rowsOf(m.id)).toBe(5);
    });

    it('repetido varias veces seguidas nunca pasa del cupo', async () => {
      for (let round = 0; round < 4; round++) {
        const m = await open(players[0], 3);
        await Promise.allSettled(players.slice(1, 16).map((p) => matches.join(p, m.id)));
        expect((await row(m.id)).spots_taken).toBe(3);
        expect(await rowsOf(m.id)).toBe(3);
      }
    });

    it('la misma persona 8 veces a la vez ocupa un solo lugar', async () => {
      const m = await open(players[0], 5);
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => matches.join(players[1], m.id)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await row(m.id)).spots_taken).toBe(1);
      expect(await rowsOf(m.id)).toBe(1);
    });

    it('entradas y salidas a la vez dejan el contador igual a la cantidad real de jugadores', async () => {
      const m = await open(players[0], 10);
      await Promise.all(players.slice(1, 11).map((p) => matches.join(p, m.id)));
      const ops = [
        ...players.slice(1, 6).map((p) => matches.leave(p, m.id)), // salen 5
        ...players.slice(11, 16).map((p) => matches.join(p, m.id)), // entran 5
      ];
      await Promise.allSettled(ops);
      const spotsTaken = (await row(m.id)).spots_taken;
      expect(spotsTaken).toBe(await rowsOf(m.id));
      expect(spotsTaken).toBeLessThanOrEqual(10);
    });
  });

  describe('salirse', () => {
    it('libera el lugar y otra persona puede tomarlo', async () => {
      const m = await open(players[0], 1);
      await matches.join(players[1], m.id);
      await expect(matches.join(players[2], m.id)).rejects.toThrow('completo');

      await expect(matches.leave(players[1], m.id)).resolves.toMatchObject({ spotsTaken: 0 });
      await expect(matches.join(players[2], m.id)).resolves.toMatchObject({ spotsTaken: 1 });
    });

    it('quien no está en el partido recibe 404 y el cupo no se toca', async () => {
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      await expect(matches.leave(players[2], m.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await row(m.id)).spots_taken).toBe(1);
    });

    it('salir dos veces a la vez solo descuenta una', async () => {
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      await matches.join(players[2], m.id);
      await Promise.allSettled([matches.leave(players[1], m.id), matches.leave(players[1], m.id)]);
      expect((await row(m.id)).spots_taken).toBe(1);
      expect(await rowsOf(m.id)).toBe(1);
    });
  });

  describe('cancelaciones', () => {
    it('cancelar la reserva cierra el partido y nadie más puede unirse', async () => {
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      const bookingId = (await row(m.id)).booking_id;

      await bookings.cancel(players[0], bookingId);

      expect((await row(m.id)).status).toBe(MatchStatus.Cancelled);
      await expect(matches.join(players[2], m.id)).rejects.toThrow('cancelado');
      expect((await matches.search({})).data).toHaveLength(0);
    });

    it('si cancelan la reserva mientras muchos se unen, el cupo no queda inconsistente', async () => {
      const m = await open(players[0], 10);
      const bookingId = (await row(m.id)).booking_id;
      await Promise.allSettled([
        bookings.cancel(players[0], bookingId),
        ...players.slice(1, 15).map((p) => matches.join(p, m.id)),
      ]);
      expect((await row(m.id)).status).toBe(MatchStatus.Cancelled);
      expect((await row(m.id)).spots_taken).toBe(await rowsOf(m.id));
    });

    it('el organizador cierra su partido; un tercero no; un admin sí', async () => {
      const m = await open(players[0], 3);
      await expect(matches.cancel(players[1], m.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(matches.cancel(players[0], m.id)).resolves.toMatchObject({ status: 'cancelled' });
      await expect(matches.cancel(players[0], m.id)).rejects.toBeInstanceOf(ConflictException);
      const m2 = await open(players[1], 3);
      await expect(matches.cancel(admin, m2.id)).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('un partido cancelado no admite entradas ni salidas', async () => {
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      await matches.cancel(players[0], m.id);
      await expect(matches.join(players[2], m.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(matches.leave(players[1], m.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('búsqueda', () => {
    it('lista solo partidos abiertos, con lugares, de reservas confirmadas y futuras', async () => {
      const full = await open(players[0], 1);
      await matches.join(players[1], full.id);
      const cancelled = await open(players[2], 3);
      await matches.cancel(players[2], cancelled.id);
      const past = await open(players[3], 3);
      await ds.query(
        `UPDATE bookings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = (SELECT booking_id FROM matches WHERE id = $1)`,
        [past.id],
      );
      const good = await open(players[4], 3);

      const list = await matches.search({});
      expect(list.data.map((m) => m.id)).toEqual([good.id]);
      expect(list.total).toBe(1);
    });

    it('filtra por deporte, nivel, zona y fecha', async () => {
      const volley = await ds.getRepository(Court).save(
        ds.getRepository(Court).create({ venueId, name: 'Vóley', sport: Sport.Volleyball, pricePerHour: 50 }),
      );
      const a = await open(players[0], 3, { level: MatchLevel.Casual });
      const b = await matches.open(players[1], { bookingId: await booking(players[1], 'confirmed', volley.id), spots: 3, level: MatchLevel.Advanced });
      const c = await matches.open(players[2], { bookingId: await booking(players[2], 'confirmed', courtId, 5), spots: 3 });

      const ids = async (q: object) => (await matches.search(q)).data.map((m) => m.id).sort();
      expect(await ids({ sport: Sport.Volleyball })).toEqual([b.id]);
      expect(await ids({ level: MatchLevel.Advanced })).toEqual([b.id]);
      expect(await ids({ zone: 'miraflor' })).toEqual([a.id, b.id, c.id].sort());
      expect(await ids({ zone: 'Barranco' })).toEqual([]);
      const day = new Date(a.startsAt).toISOString().slice(0, 10);
      const sameDay = await ids({ date: new Date(new Date(a.startsAt).getTime() - 5 * 3_600_000).toISOString().slice(0, 10) });
      expect(sameDay).toEqual([a.id, b.id].sort());
      expect(day).toBeTruthy();
    });

    it('ordena por fecha y pagina', async () => {
      const later = await matches.open(players[0], { bookingId: await booking(players[0], 'confirmed', courtId, 6), spots: 2 });
      const sooner = await matches.open(players[1], { bookingId: await booking(players[1], 'confirmed', courtId, 4), spots: 2 });
      const page1 = await matches.search({ page: 1, limit: 1 });
      const page2 = await matches.search({ page: 2, limit: 1 });
      expect(page1.data[0].id).toBe(sooner.id);
      expect(page2.data[0].id).toBe(later.id);
      expect(page1.total).toBe(2);
    });

    it('"mis partidos" muestra los que organizo y a los que me uní, con mi rol', async () => {
      const mine = await open(players[0], 3);
      const other = await open(players[1], 3);
      await matches.join(players[0], other.id);
      await open(players[2], 3); // ajeno

      const list = await matches.listMine(players[0]);
      expect(list.map((m) => [m.id, m.role]).sort()).toEqual([[mine.id, 'organizer'], [other.id, 'player']].sort());
    });
  });

  describe('datos para la interfaz en "mis reservas"', () => {
    it('indica si la reserva ya tiene partido abierto y si ya fue reseñada', async () => {
      const m = await open(players[0], 3);
      const bookingId = (await row(m.id)).booking_id;
      const plain = await booking(players[0]);

      let mine = await bookings.listMine(players[0]);
      expect(mine.find((b) => b.id === bookingId)).toMatchObject({ matchId: m.id, reviewed: false });
      expect(mine.find((b) => b.id === plain)).toMatchObject({ matchId: null, reviewed: false });

      await ds.query(`INSERT INTO reviews (booking_id, venue_id, player_id, rating) VALUES ($1, $2, $3, 5)`, [bookingId, venueId, players[0].id]);
      await matches.cancel(players[0], m.id);
      mine = await bookings.listMine(players[0]);
      expect(mine.find((b) => b.id === bookingId)).toMatchObject({ matchId: null, reviewed: true }); // partido cancelado ya no cuenta
    });
  });

  describe('eventos para el chat (bandeja de salida)', () => {
    interface Sent { type: string; payload: any }
    const sent = async (): Promise<Sent[]> =>
      ds.query(`SELECT type, payload FROM outbox_events WHERE type LIKE 'match.%' ORDER BY (payload->>'version')::int, created_at`);

    it('abrir publica match.opened con el estado completo y versión 1', async () => {
      const m = await open(players[0], 3);
      const events = await sent();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('match.opened');
      expect(events[0].payload).toMatchObject({
        matchId: m.id, status: 'open', version: 1, organizerId: players[0].id,
        members: [{ id: players[0].id, name: 'Jugador0' }], venueName: 'Local', courtName: 'Cancha 1', changedPlayer: null,
      });
      expect(JSON.stringify(events[0].payload)).not.toMatch(/@test\.com|Apellido/); // sin correos ni apellidos
    });

    it('entrar, salir y cancelar suben la versión de uno en uno y reflejan a los miembros', async () => {
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      await matches.join(players[2], m.id);
      await matches.leave(players[1], m.id);
      await matches.cancel(players[0], m.id);
      const events = await sent();
      expect(events.map((e) => [e.type, e.payload.version, e.payload.members.length, e.payload.status, e.payload.changedPlayer?.id ?? null])).toEqual([
        ['match.opened', 1, 1, 'open', null],
        ['match.player_joined', 2, 2, 'open', players[1].id],
        ['match.player_joined', 3, 3, 'open', players[2].id],
        ['match.player_left', 4, 2, 'open', players[1].id],
        ['match.cancelled', 5, 2, 'cancelled', null],
      ]);
      expect(events[4].payload.members.map((x: any) => x.id)).toEqual([players[0].id, players[2].id]);
    });

    it('un intento que falla no deja evento ni sube la versión', async () => {
      const m = await open(players[0], 1);
      await matches.join(players[1], m.id);
      await expect(matches.join(players[2], m.id)).rejects.toBeInstanceOf(ConflictException); // completo
      await expect(matches.join(players[1], m.id)).rejects.toBeInstanceOf(ConflictException); // repetido
      await expect(matches.leave(players[3], m.id)).rejects.toBeInstanceOf(NotFoundException); // no estaba
      await matches.cancel(players[0], m.id);
      await expect(matches.cancel(players[0], m.id)).rejects.toBeInstanceOf(ConflictException);
      expect((await sent()).map((e) => e.payload.version)).toEqual([1, 2, 3]);
      expect((await row(m.id)).version).toBe(3);
    });

    it('con 12 personas entrando a la vez por 8 lugares, cada versión describe exactamente a sus miembros', async () => {
      const m = await open(players[0], 8);
      await Promise.allSettled(players.slice(1, 13).map((p) => matches.join(p, m.id)));
      const events = await sent();
      expect(events).toHaveLength(9); // opened + 8 entradas
      // Versión v = organizador + (v-1) jugadores: la instantánea nunca se adelanta ni se atrasa.
      for (const e of events) expect(e.payload.members).toHaveLength(e.payload.version);
      expect(events.map((e) => e.payload.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(new Set(events[8].payload.members.map((x: any) => x.id)).size).toBe(9);
    });

    it('entradas y salidas simultáneas: la última versión coincide con los jugadores reales', async () => {
      const m = await open(players[0], 10);
      for (const p of players.slice(1, 6)) await matches.join(p, m.id);
      await Promise.allSettled([
        ...players.slice(1, 6).map((p) => matches.leave(p, m.id)),
        ...players.slice(6, 12).map((p) => matches.join(p, m.id)),
      ]);
      const events = await sent();
      const last = events[events.length - 1].payload;
      const real = await ds.query('SELECT player_id FROM match_players WHERE match_id = $1', [m.id]);
      expect(last.version).toBe((await row(m.id)).version);
      expect(last.members.map((x: any) => x.id).sort()).toEqual([players[0].id, ...real.map((r: any) => r.player_id)].sort());
    });

    // Mismo ejemplo que valida el chat-service (docs/contracts). Si no está disponible (p. ej. en Docker sin el montaje), se omite.
    const contractFile = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'match-events.v1.example.json');
    (existsSync(contractFile) ? it : it.skip)('lo que se publica tiene la forma del ejemplo del contrato', async () => {
      const shape = (v: unknown): unknown =>
        v !== null && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).sort().map(([k, x]) => [k, shape(x)]))
          : typeof v;
      const example = JSON.parse(readFileSync(contractFile, 'utf8'));
      const m = await open(players[0], 3);
      await matches.join(players[1], m.id);
      const joined = (await sent()).find((e) => e.type === 'match.player_joined')!;
      expect(shape(joined.payload)).toEqual(shape(example.data));
      expect(example.type).toBe('match.player_joined');
    });
  });

  describe('integridad en la base de datos', () => {
    it('rechaza más jugadores que lugares aunque se salte el servicio', async () => {
      const m = await open(players[0], 2);
      await expect(ds.query('UPDATE matches SET spots_taken = 3 WHERE id = $1', [m.id])).rejects.toMatchObject({ code: '23514' });
      await expect(ds.query('UPDATE matches SET spots_taken = -1 WHERE id = $1', [m.id])).rejects.toMatchObject({ code: '23514' });
    });

    it('rechaza cupos fuera de 1 a 20', async () => {
      const m = await open(players[0], 2);
      for (const n of [0, 21]) {
        await expect(ds.query('UPDATE matches SET spots_total = $2 WHERE id = $1', [m.id, n])).rejects.toMatchObject({ code: '23514' });
      }
    });

    it('una reserva con partido no se puede borrar', async () => {
      const m = await open(players[0], 2);
      await expect(ds.query('DELETE FROM bookings WHERE id = $1', [(await row(m.id)).booking_id])).rejects.toMatchObject({ code: '23503' });
    });

    it('el organizador (dueño) del local también puede jugar partidos de otros', async () => {
      const m = await open(players[0], 2);
      await expect(matches.join(owner, m.id)).resolves.toMatchObject({ spotsTaken: 1 });
    });
  });
});
