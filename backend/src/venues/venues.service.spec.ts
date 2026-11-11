import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Review } from '../reviews/review.entity';
import { Role } from '../users/role.enum';
import { Court } from './court.entity';
import { Venue } from './venue.entity';
import { VenuesService } from './venues.service';

describe('VenuesService (permisos)', () => {
  const owner: AuthUser = { id: 'owner-1', email: 'o@x.com', role: Role.Owner };
  const otherOwner: AuthUser = { id: 'owner-2', email: 'p@x.com', role: Role.Owner };
  const admin: AuthUser = { id: 'admin-1', email: 'a@x.com', role: Role.Admin };

  let venues: { findOne: jest.Mock; save: jest.Mock; remove: jest.Mock };
  let courts: { findOne: jest.Mock; save: jest.Mock; remove: jest.Mock; create: jest.Mock };
  let service: VenuesService;

  beforeEach(() => {
    venues = { findOne: jest.fn(), save: jest.fn(async (v) => v), remove: jest.fn() };
    courts = {
      findOne: jest.fn(),
      save: jest.fn(async (c) => c),
      remove: jest.fn(),
      create: jest.fn((c) => c),
    };
    service = new VenuesService(
      venues as unknown as Repository<Venue>,
      courts as unknown as Repository<Court>,
      {} as Repository<Review>,
    );
  });

  it('el dueño puede editar su local', async () => {
    venues.findOne.mockResolvedValue({ id: 'v-1', ownerId: owner.id, name: 'Viejo' });
    const result = await service.updateVenue(owner, 'v-1', { name: 'Nuevo' });
    expect(result.name).toBe('Nuevo');
  });

  it('otro dueño no puede editar un local ajeno', async () => {
    venues.findOne.mockResolvedValue({ id: 'v-1', ownerId: owner.id });
    await expect(service.updateVenue(otherOwner, 'v-1', { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(venues.save).not.toHaveBeenCalled();
  });

  it('un admin puede borrar cualquier local', async () => {
    venues.findOne.mockResolvedValue({ id: 'v-1', ownerId: owner.id });
    await service.removeVenue(admin, 'v-1');
    expect(venues.remove).toHaveBeenCalled();
  });

  it('otro dueño no puede agregar canchas a un local ajeno', async () => {
    venues.findOne.mockResolvedValue({ id: 'v-1', ownerId: owner.id });
    await expect(
      service.addCourt(otherOwner, 'v-1', { name: 'C1', sport: 'football' as never, pricePerHour: 80 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('editar una cancha comprueba el dueño de su local', async () => {
    courts.findOne.mockResolvedValue({ id: 'c-1', venue: { ownerId: owner.id } });
    await expect(service.updateCourt(otherOwner, 'c-1', { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('devuelve 404 si el local no existe', async () => {
    venues.findOne.mockResolvedValue(null);
    await expect(service.updateVenue(owner, 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
