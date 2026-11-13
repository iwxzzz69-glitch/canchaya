import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { BookingStatus } from '../bookings/booking-status.enum';
import { Booking } from '../bookings/booking.entity';
import { addHours, localInstant, parseLocalDate } from '../bookings/local-time';
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from '../common/db-errors';
import { enqueueMatchEvent } from '../events/outbox';
import { Role } from '../users/role.enum';
import { CreateMatchDto, SearchMatchesDto } from './dto/match.dto';
import { MatchLevel } from './match-level.enum';
import { MatchPlayer } from './match-player.entity';
import { MatchStatus } from './match-status.enum';
import { Match } from './match.entity';

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

@Injectable()
export class MatchesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Forma pública de un partido: solo el primer nombre de las personas, nunca correos ni ids de usuario. */
  private view(match: Match) {
    const { booking } = match;
    const players = Math.max(match.spotsTotal + 1, 1);
    return {
      id: match.id,
      status: match.status,
      level: match.level,
      notes: match.notes,
      organizer: firstName(match.organizer.name),
      sport: booking.court.sport,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      spotsTotal: match.spotsTotal,
      spotsTaken: match.spotsTaken,
      spotsLeft: match.spotsTotal - match.spotsTaken,
      // Referencia para repartir el costo entre todos los que juegan (el pago sigue siendo del organizador).
      suggestedPricePerPlayer: Math.round((booking.totalPrice / players) * 100) / 100,
      court: { id: booking.court.id, name: booking.court.name },
      venue: {
        id: booking.court.venue.id,
        name: booking.court.venue.name,
        address: booking.court.venue.address,
        zone: booking.court.venue.zone,
      },
    };
  }

  private baseQuery(manager: EntityManager = this.ds.manager) {
    return manager
      .getRepository(Match)
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.booking', 'b')
      .innerJoinAndSelect('b.court', 'c')
      .innerJoinAndSelect('c.venue', 'v')
      .innerJoinAndSelect('m.organizer', 'o');
  }

  async open(user: AuthUser, dto: CreateMatchDto) {
    const id = await this.ds.transaction(async (manager) => {
      // Se bloquea la reserva: no puede cancelarse a mitad de abrir el partido.
      const booking = await manager.findOne(Booking, {
        where: { id: dto.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Reserva no encontrada');
      if (booking.playerId !== user.id) throw new ForbiddenException('Esta reserva no es tuya');
      if (booking.status !== BookingStatus.Confirmed) {
        throw new ConflictException('Solo puedes abrir un partido con una reserva confirmada y pagada');
      }
      if (booking.startsAt.getTime() <= Date.now()) {
        throw new ConflictException('Esa reserva ya empezó');
      }
      try {
        const saved = await manager.save(
          manager.create(Match, {
            bookingId: booking.id,
            organizerId: user.id,
            spotsTotal: dto.spots,
            spotsTaken: 0,
            version: 1,
            level: dto.level ?? MatchLevel.Casual,
            notes: dto.notes?.trim() || null,
          }),
        );
        await enqueueMatchEvent(manager, 'match.opened', saved.id);
        return saved.id;
      } catch (error) {
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
          throw new ConflictException('Ya abriste un partido para esta reserva');
        }
        throw error;
      }
    });
    return this.getOne(id);
  }

  async search(query: SearchMatchesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.baseQuery()
      .where('m.status = :open', { open: MatchStatus.Open })
      .andWhere('b.status = :confirmed', { confirmed: BookingStatus.Confirmed })
      .andWhere('b.startsAt > now()')
      .andWhere('m.spotsTaken < m.spotsTotal'); // solo partidos a los que aún se puede entrar
    if (query.sport) qb.andWhere('c.sport = :sport', { sport: query.sport });
    if (query.level) qb.andWhere('m.level = :level', { level: query.level });
    if (query.zone) qb.andWhere('v.zone ILIKE :zone', { zone: `%${query.zone}%` });
    if (query.date) {
      const d = parseLocalDate(query.date);
      if (d) {
        const from = localInstant(d.year, d.month, d.day, 0);
        qb.andWhere('b.startsAt >= :from AND b.startsAt < :to', { from, to: addHours(from, 24) });
      }
    }
    const [rows, total] = await qb
      .orderBy('b.startsAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data: rows.map((m) => this.view(m)), total, page, limit };
  }

  async getOne(id: string) {
    const match = await this.baseQuery().where('m.id = :id', { id }).getOne();
    if (!match) throw new NotFoundException('Partido no encontrado');
    const players = await this.ds
      .getRepository(MatchPlayer)
      .createQueryBuilder('mp')
      .innerJoinAndSelect('mp.player', 'p')
      .where('mp.matchId = :id', { id })
      .orderBy('mp.joinedAt', 'ASC')
      .getMany();
    return { ...this.view(match), players: players.map((p) => ({ name: firstName(p.player.name), joinedAt: p.joinedAt })) };
  }

  async listMine(user: AuthUser) {
    const rows = await this.baseQuery()
      .where(
        'm.organizerId = :uid OR m.id IN (SELECT mp.match_id FROM match_players mp WHERE mp.player_id = :uid)',
        { uid: user.id },
      )
      .orderBy('b.startsAt', 'DESC')
      .addOrderBy('m.id', 'ASC')
      .take(100)
      .getMany();
    return rows.map((m) => ({ ...this.view(m), role: m.organizerId === user.id ? 'organizer' : 'player' }));
  }

  /** Explica por qué no se pudo ocupar un lugar. Solo se llama cuando el UPDATE atómico no afectó a nadie. */
  private async explainJoinFailure(manager: EntityManager, matchId: string, userId: string): Promise<Error> {
    const match = await manager.findOne(Match, { where: { id: matchId }, relations: { booking: true } });
    if (!match) return new NotFoundException('Partido no encontrado');
    if (match.organizerId === userId) return new ConflictException('Eres el organizador de este partido');
    if (match.status !== MatchStatus.Open) return new ConflictException('El partido fue cancelado');
    if (match.booking.status !== BookingStatus.Confirmed) return new ConflictException('La reserva de este partido ya no está vigente');
    if (match.booking.startsAt.getTime() <= Date.now()) return new ConflictException('El partido ya empezó');
    return new ConflictException('El partido ya está completo');
  }

  async join(user: AuthUser, matchId: string) {
    await this.ds.transaction(async (manager) => {
      try {
        await manager.insert(MatchPlayer, { matchId, playerId: user.id });
      } catch (error) {
        const code = pgErrorCode(error);
        if (code === PG_UNIQUE_VIOLATION) throw new ConflictException('Ya estás en este partido');
        if (code === PG_FOREIGN_KEY_VIOLATION) throw new NotFoundException('Partido no encontrado');
        throw error;
      }
      // Ocupar el lugar es UN solo UPDATE que comprueba todo a la vez (cupo, estado y que la reserva
      // siga vigente). Si dos personas van por el último lugar, PostgreSQL las atiende de una en una:
      // la segunda ve el cupo ya ocupado y no actualiza nada. Al fallar, se deshace también el INSERT.
      const result = await manager
        .createQueryBuilder()
        .update(Match)
        .set({ spotsTaken: () => '"spots_taken" + 1', version: () => '"version" + 1' })
        .where(
          `id = :matchId AND status = 'open' AND spots_taken < spots_total AND organizer_id <> :uid
           AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = matches.booking_id
                       AND b.status = 'confirmed' AND b.starts_at > now())`,
          { matchId, uid: user.id },
        )
        .execute();
      if (!result.affected) throw await this.explainJoinFailure(manager, matchId, user.id);
      await enqueueMatchEvent(manager, 'match.player_joined', matchId, user.id);
    });
    return this.getOne(matchId);
  }

  async leave(user: AuthUser, matchId: string) {
    await this.ds.transaction(async (manager) => {
      const match = await manager.findOne(Match, {
        where: { id: matchId },
        relations: { booking: true },
        lock: { mode: 'pessimistic_write', tables: ['matches'] },
      });
      if (!match) throw new NotFoundException('Partido no encontrado');
      if (match.status !== MatchStatus.Open) throw new ConflictException('El partido fue cancelado');
      if (match.booking.startsAt.getTime() <= Date.now()) throw new ConflictException('El partido ya empezó');
      const removed = await manager.delete(MatchPlayer, { matchId, playerId: user.id });
      if (!removed.affected) throw new NotFoundException('No estás en este partido');
      await manager
        .createQueryBuilder()
        .update(Match)
        .set({ spotsTaken: () => '"spots_taken" - 1', version: () => '"version" + 1' })
        .where('id = :matchId', { matchId })
        .execute();
      await enqueueMatchEvent(manager, 'match.player_left', matchId, user.id);
    });
    return this.getOne(matchId);
  }

  /** El organizador (o un admin) cierra el partido; la reserva no se toca. */
  async cancel(user: AuthUser, matchId: string) {
    const match = await this.ds.getRepository(Match).findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Partido no encontrado');
    if (match.organizerId !== user.id && user.role !== Role.Admin) {
      throw new ForbiddenException('Solo el organizador puede cancelar el partido');
    }
    await this.ds.transaction(async (manager) => {
      // Un solo UPDATE condicionado al estado: si dos cancelaciones llegan juntas, solo una cuenta.
      const result = await manager
        .createQueryBuilder()
        .update(Match)
        .set({ status: MatchStatus.Cancelled, version: () => '"version" + 1' })
        .where('id = :matchId AND status = :open', { matchId, open: MatchStatus.Open })
        .execute();
      if (!result.affected) throw new ConflictException('El partido ya estaba cancelado');
      await enqueueMatchEvent(manager, 'match.cancelled', matchId);
    });
    return this.getOne(matchId);
  }
}
