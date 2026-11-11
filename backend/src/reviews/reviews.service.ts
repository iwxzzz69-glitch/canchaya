import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { BookingStatus } from '../bookings/booking-status.enum';
import { Booking } from '../bookings/booking.entity';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from '../common/db-errors';
import { Role } from '../users/role.enum';
import { Venue } from '../venues/venue.entity';
import { CreateReviewDto } from './dto/review.dto';
import { Review } from './review.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
  ) {}

  async create(user: AuthUser, bookingId: string, dto: CreateReviewDto) {
    const booking = await this.bookings.findOne({ where: { id: bookingId }, relations: { court: true } });
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.playerId !== user.id) throw new ForbiddenException('Esta reserva no es tuya');
    if (booking.status !== BookingStatus.Confirmed) {
      throw new ConflictException('Solo se pueden reseñar reservas confirmadas');
    }
    if (booking.endsAt.getTime() > Date.now()) {
      throw new ConflictException('Podrás reseñar cuando termine tu reserva');
    }

    try {
      const saved = await this.reviews.save(
        this.reviews.create({
          bookingId,
          venueId: booking.court.venueId,
          playerId: user.id,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
        }),
      );
      return {
        id: saved.id,
        bookingId: saved.bookingId,
        venueId: saved.venueId,
        rating: saved.rating,
        comment: saved.comment,
        createdAt: saved.createdAt,
      };
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Ya reseñaste esta reserva');
      }
      throw error;
    }
  }

  // Público. Solo se muestra el primer nombre de quien reseña.
  async listForVenue(venueId: string, page = 1, limit = 20) {
    if (!(await this.venues.exist({ where: { id: venueId } }))) {
      throw new NotFoundException('Local no encontrado');
    }
    const [rows, total] = await this.reviews.findAndCount({
      where: { venueId },
      relations: { player: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const stats = await this.reviews
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'average')
      .where('r.venueId = :venueId', { venueId })
      .getRawOne<{ average: string | null }>();

    return {
      average: stats?.average ? Math.round(Number(stats.average) * 10) / 10 : null,
      total,
      page,
      limit,
      data: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        author: r.player.name.split(' ')[0],
      })),
    };
  }

  async remove(user: AuthUser, id: string) {
    const review = await this.reviews.findOne({ where: { id } });
    if (!review) throw new NotFoundException('Reseña no encontrada');
    if (user.role !== Role.Admin && review.playerId !== user.id) {
      throw new ForbiddenException('Esta reseña no es tuya');
    }
    await this.reviews.remove(review);
  }
}
