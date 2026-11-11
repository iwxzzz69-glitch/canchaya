import * as path from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { localDateString, localInstant, parseLocalDate } from '../bookings/local-time';
import { ALL_ENTITIES } from '../database/entities';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import { Court } from '../venues/court.entity';
import { Sport } from '../venues/sport.enum';
import { Venue } from '../venues/venue.entity';

/**
 * Utilidades de los tests de integración. Usan DATABASE_URL solo para conectarse al servidor y
 * crean (y borran) su propia base de datos por archivo de test: nunca tocan los datos reales.
 */
export const BASE_URL = process.env.DATABASE_URL;
export const hasDatabase = Boolean(BASE_URL);

const withDatabase = (url: string, database: string) => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

async function dropDatabase(name: string) {
  if (!/^canchaya_test_[a-z_]+$/.test(name)) throw new Error(`Nombre de base de pruebas inválido: ${name}`);
  const admin = new Client({ connectionString: withDatabase(BASE_URL as string, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export async function createTestDatabase(name: string): Promise<DataSource> {
  await dropDatabase(name);
  const admin = new Client({ connectionString: withDatabase(BASE_URL as string, 'postgres') });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const ds = new DataSource({
    type: 'postgres',
    url: withDatabase(BASE_URL as string, name),
    entities: ALL_ENTITIES,
    migrations: [path.join(__dirname, '..', 'database', 'migrations', '*.ts')],
    extra: { max: 30 },
  });
  await ds.initialize();
  await ds.runMigrations(); // el esquema sale de las migraciones reales, igual que en producción
  return ds;
}

export async function destroyTestDatabase(ds: DataSource | undefined, name: string) {
  await ds?.destroy();
  await dropDatabase(name);
}

export interface Seed {
  owner: AuthUser;
  players: AuthUser[];
  venueId: string;
  courtId: string;
}

/** Un dueño, `playerCount` jugadores, un local y una cancha de S/ 80 por hora (08:00-23:00). */
export async function seedBasics(ds: DataSource, playerCount: number): Promise<Seed> {
  const users = ds.getRepository(User);
  const ownerRow = await users.save(
    users.create({ email: 'dueno@test.com', passwordHash: 'x', name: 'Dueño Uno', role: Role.Owner }),
  );
  const players: AuthUser[] = [];
  for (let i = 0; i < playerCount; i++) {
    const row = await users.save(
      users.create({ email: `j${i}@test.com`, passwordHash: 'x', name: `Jugador${i} Apellido`, role: Role.Player }),
    );
    players.push({ id: row.id, email: row.email, role: Role.Player });
  }
  const venue = await ds.getRepository(Venue).save(
    ds.getRepository(Venue).create({ ownerId: ownerRow.id, name: 'Local', address: 'Av. 1', zone: 'Miraflores' }),
  );
  const court = await ds.getRepository(Court).save(
    ds.getRepository(Court).create({
      venueId: venue.id,
      name: 'Cancha 1',
      sport: Sport.Football,
      pricePerHour: 80,
    }),
  );
  return {
    owner: { id: ownerRow.id, email: ownerRow.email, role: Role.Owner },
    players,
    venueId: venue.id,
    courtId: court.id,
  };
}

/** Instante futuro (hoy + días) a las `hour`:00 hora de Lima, como ISO. */
export function slot(hour: number, daysAhead = 3): string {
  const d = parseLocalDate(localDateString(new Date(Date.now() + daysAhead * 86_400_000)));
  if (!d) throw new Error('fecha inválida');
  return localInstant(d.year, d.month, d.day, hour).toISOString();
}
