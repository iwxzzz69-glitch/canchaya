import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity';
import { Venue } from '../venues/venue.entity';
import { Court } from '../venues/court.entity';

// Usado por el CLI de TypeORM (npm run migration:generate / migration:run).
// La aplicación usa la misma configuración desde AppModule.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Venue, Court],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});
