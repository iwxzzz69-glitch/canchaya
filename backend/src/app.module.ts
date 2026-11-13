import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { EventsModule } from './events/events.module';
import { ALL_ENTITIES } from './database/entities';
import { HealthController } from './health.controller';
import { MatchesModule } from './matches/matches.module';
import { PaymentsModule } from './payments/payments.module';
import { ReviewsModule } from './reviews/reviews.module';
import { UsersModule } from './users/users.module';
import { VenuesModule } from './venues/venues.module';

// Módulo de dominio pendiente: AdminModule
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        // Lista única (la misma de las migraciones y los tests): olvidar registrar una entidad en un módulo
        // ya no puede dejarla fuera en producción.
        entities: ALL_ENTITIES,
        // El esquema lo gestionan las migraciones, nunca synchronize.
        synchronize: false,
        migrationsRun: true,
        migrations: [__dirname + '/database/migrations/*.{ts,js}'],
      }),
    }),
    UsersModule,
    AuthModule,
    VenuesModule,
    BookingsModule,
    PaymentsModule,
    ReviewsModule,
    MatchesModule,
    EventsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
