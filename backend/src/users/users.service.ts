import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './role.enum';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  create(data: { email: string; passwordHash: string; name: string; role: Role }) {
    const user = this.repo.create({ ...data, email: data.email.toLowerCase() });
    return this.repo.save(user);
  }
}
