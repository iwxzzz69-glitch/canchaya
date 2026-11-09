import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
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
  ) {}

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

    return { data, total, page, limit };
  }

  listMine(owner: AuthUser) {
    return this.venues.find({
      where: { ownerId: owner.id },
      relations: { courts: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const venue = await this.venues
      .createQueryBuilder('venue')
      .leftJoinAndSelect('venue.courts', 'court', 'court.isActive = true')
      .where('venue.id = :id', { id })
      .getOne();
    if (!venue) throw new NotFoundException('Local no encontrado');
    return venue;
  }

  async updateVenue(user: AuthUser, id: string, dto: UpdateVenueDto) {
    const venue = await this.getVenueOrFail(id);
    this.assertCanManage(user, venue.ownerId);
    Object.assign(venue, dto);
    return this.venues.save(venue);
  }

  async removeVenue(user: AuthUser, id: string) {
    const venue = await this.getVenueOrFail(id);
    this.assertCanManage(user, venue.ownerId);
    await this.venues.remove(venue);
  }

  async addCourt(user: AuthUser, venueId: string, dto: CreateCourtDto) {
    const venue = await this.getVenueOrFail(venueId);
    this.assertCanManage(user, venue.ownerId);
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
    const saved = await this.courts.save(court);
    const { venue: _venue, ...result } = saved;
    return result;
  }

  async removeCourt(user: AuthUser, id: string) {
    const court = await this.getCourtOrFail(id);
    this.assertCanManage(user, court.venue.ownerId);
    await this.courts.remove(court);
  }
}
