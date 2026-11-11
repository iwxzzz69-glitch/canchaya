import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

// Usado por el CLI de TypeORM (npm run migration:generate / migration:run).
// La aplicación usa la misma configuración desde AppModule.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ALL_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});
