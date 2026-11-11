import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { PG_FOREIGN_KEY_VIOLATION, pgErrorCode } from '../common/db-errors';
import { Review } from '../reviews/review.entity';
import { Role } from '../users/role.enum';
import { Court } from './court.entity';
import {
  CreateCourtDto,
  CreateVenueDto,
  SearchVenuesDto,
  UpdateCourtDto,
  UpdateVenueDto,
} from './dto/venue.dto';
import { Venue } from './venue.entity';

@Injectable()
export class VenuesService {
  constructor(
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
    @InjectRepository(Court) private readonly courts: Repository<Court>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
  ) {}

  // Agrega a cada local su calificación promedio y cantidad de reseñas, con una sola consulta.
  private async withRatings<T extends Venue>(venues: T[]) {
    if (venues.length === 0) return [];
    const rows = await this.reviews
      .createQueryBuilder('r')
      .select('r.venueId', 'venueId')
      .addSelect('AVG(r.rating)', 'average')
      .addSelect('COUNT(*)', 'count')
      .where('r.venueId IN (:...ids)', { ids: venues.map((v) => v.id) })
      .groupBy('r.venueId')
      .getRawMany<{ venueId: string; average: string; count: string }>();
    const byVenue = new Map(rows.map((r) => [r.venueId, r]));
    return venues.map((venue) => {
      const stats = byVenue.get(venue.id);
      return {
        ...venue,
        rating: {
          average: stats ? Math.round(Number(stats.average) * 10) / 10 : null,
          count: stats ? Number(stats.count) : 0,
        },
      };
    });
  }

  // Solo el dueño del local (o un admin) puede modificarlo.
  private assertCanManage(user: AuthUser, ownerId: string) {
    if (user.role !== Role.Admin && user.id !== ownerId) {
      throw new ForbiddenException('Este local no te pertenece');
    }
  }

  private async getVenueOrFail(id: string) {
    const venue = await this.venues.findOne({ where: { id } });
    if (!venue) throw new NotFoundException('Local no encontrado');
    return venue;
  }

  createVenue(owner: AuthUser, dto: CreateVenueDto) {
    const venue = this.venues.create({
      ...dto,
      description: dto.description ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      ownerId: owner.id,
    });
    return this.venues.save(venue);
  }

  async search(query: SearchVenuesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const hasCourtFilter = query.sport !== undefined || query.maxPrice !== undefined;

    const qb = this.venues.createQueryBuilder('venue');
    // Con filtros de cancha solo aparecen locales que tengan alguna cancha que cumpla.
    if (hasCourtFilter) {
      qb.innerJoinAndSelect('venue.courts', 'court', 'court.isActive = true');
    } else {
      qb.leftJoinAndSelect('venue.courts', 'court', 'court.isActive = true');
    }
    if (query.zone) qb.andWhere('venue.zone ILIKE :zone', { zone: `%${query.zone}%` });
    if (query.sport) qb.andWhere('court.sport = :sport', { sport: query.sport });
    if (query.maxPrice !== undefined) {
      qb.andWhere('court.pricePerHour <= :maxPrice', { maxPrice: query.maxPrice });
    }

    const [data, total] = await qb
      .orderBy('venue.createdAt', 'DESC')
      .addOrderBy('venue.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data: await this.withRatings(data), total, page, limit };
  }

  async listMine(owner: AuthUser) {
    const mine = await this.venues.find({
      where: { ownerId: owner.id },
      relations: { courts: true },
      order: { createdAt: 'DESC' },
    });
    return this.withRatings(mine);
  }

  async findOne(id: string) {
    const venue = await this.venues
      .createQueryBuilder('venue')
      .leftJoinAndSelect('venue.courts', 'court', 'court.isActive = true')
      .where('venue.id = :id', { id })
      .getOne();
    if (!venue) throw new NotFoundException('Local no encontrado');
    const [withRating] = await this.withRatings([venue]);
    return withRating;
  }

  async updateVenue(user: AuthUser, id: string, dto: UpdateVenueDto) {
    const venue = await this.getVenueOrFail(id);
    this.assertCanManage(user, venue.ownerId);
    Object.assign(venue, dto);
    return this.venues.save(venue);
  }

  // Con reservas de por medio la base de datos impide borrar (historial y pagos dependen de ellas).
  private async removeOrExplain<T extends object>(repo: Repository<T>, entity: T, what: string) {
    try {
      await repo.remove(entity);
    } catch (error) {
      if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
        throw new ConflictException(`No se puede borrar ${what} porque tiene reservas`);
      }
      throw error;
    }
  }

  private assertValidHours(openHour: number, closeHour: number) {
    if (closeHour <= openHour) {
      throw new BadRequestException('closeHour debe ser mayor que openHour');
    }
  }

  async removeVenue(user: AuthUser, id: string) {
    const venue = await this.getVenueOrFail(id);
    this.assertCanManage(user, venue.ownerId);
    await this.removeOrExplain(this.venues, venue, 'el local');
  }

  async addCourt(user: AuthUser, venueId: string, dto: CreateCourtDto) {
    const venue = await this.getVenueOrFail(venueId);
    this.assertCanManage(user, venue.ownerId);
    this.assertValidHours(dto.openHour ?? 8, dto.closeHour ?? 23);
    const court = this.courts.create({ ...dto, venueId });
    return this.courts.save(court);
  }

  private async getCourtOrFail(id: string) {
    const court = await this.courts.findOne({ where: { id }, relations: { venue: true } });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    return court;
  }

  async updateCourt(user: AuthUser, id: string, dto: UpdateCourtDto) {
    const court = await this.getCourtOrFail(id);
    this.assertCanManage(user, court.venue.ownerId);
    Object.assign(court, dto);
    this.assertValidHours(court.openHour, court.closeHour);
    const saved = await this.courts.save(court);
    const { venue: _venue, ...result } = saved;
    return result;
  }

  async removeCourt(user: AuthUser, id: string) {
    const court = await this.getCourtOrFail(id);
    this.assertCanManage(user, court.venue.ownerId);
    await this.removeOrExplain(this.courts, court, 'la cancha (desactívala en su lugar)');
  }
}
