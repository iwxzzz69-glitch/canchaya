import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Módulos de dominio previstos (se añaden por fase):
// AuthModule, VenuesModule, BookingsModule, PaymentsModule, ReviewsModule, AdminModule
@Module({
  controllers: [HealthController],
})
export class AppModule {}
