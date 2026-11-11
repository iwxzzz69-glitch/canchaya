import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../users/role.enum';
import { PayDto } from './dto/pay.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Cobra la reserva con el token de tarjeta; si sale bien, la reserva queda confirmada.
  @Post('bookings/:id/pay')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Player, Role.Owner)
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayDto,
  ) {
    return this.payments.pay(user, id, dto.tokenId);
  }

  @Get('payments/mine')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Player, Role.Owner)
  listMine(@CurrentUser() user: AuthUser) {
    return this.payments.listMine(user);
  }

  // Un admin reintenta una devolución que la pasarela rechazó.
  @Post('payments/:id/retry-refund')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  retryRefund(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.retryRefund(id);
  }

  // URL que se registra en el CulqiPanel (Eventos > Webhooks). El secreto va en la ruta.
  @Post('payments/webhooks/culqi/:secret')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(@Param('secret') secret: string, @Body() body: unknown) {
    return this.payments.handleWebhook(secret, body);
  }
}
