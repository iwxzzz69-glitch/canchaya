import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../bookings/booking.entity';
import { Payment } from './payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CulqiProvider } from './providers/culqi.provider';
import { FakePaymentProvider } from './providers/fake.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment-provider';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, Booking]), AuthModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentProvider => {
        const logger = new Logger('PaymentProvider');
        // Si hay llave de Culqi se usa Culqi; si no, la pasarela simulada (solo desarrollo).
        const kind =
          config.get<string>('PAYMENT_PROVIDER') ?? (config.get('CULQI_SECRET_KEY') ? 'culqi' : 'fake');

        if (kind === 'culqi') {
          const secretKey = config.getOrThrow<string>('CULQI_SECRET_KEY');
          logger.log(`Pasarela de pago: Culqi (${secretKey.startsWith('sk_test_') ? 'integración' : 'producción'})`);
          return new CulqiProvider({ secretKey, baseUrl: config.get<string>('CULQI_API_URL') });
        }
        if (kind === 'fake') {
          if (config.get('NODE_ENV') === 'production') {
            throw new Error('La pasarela simulada no se puede usar en producción');
          }
          logger.warn('Pasarela de pago SIMULADA activa: no se cobra nada de verdad');
          return new FakePaymentProvider();
        }
        throw new Error(`PAYMENT_PROVIDER inválido: "${kind}" (usa "culqi" o "fake")`);
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
