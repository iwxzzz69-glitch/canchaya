import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';
import { VenuesModule } from './venues/venues.module';

// Módulos de dominio pendientes: BookingsModule, PaymentsModule, ReviewsModule, AdminModule
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // El esquema lo gestionan las migraciones, nunca synchronize.
        synchronize: false,
        migrationsRun: true,
        migrations: [__dirname + '/database/migrations/*.{ts,js}'],
      }),
    }),
    UsersModule,
    AuthModule,
    VenuesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
