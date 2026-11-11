import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class PayDto {
  @ApiProperty({
    example: 'tkn_test_xxxxxxxxxxxxxxxx',
    description:
      'Token de la tarjeta, generado en el navegador con la llave PÚBLICA de Culqi (Culqi.js / Checkout). ' +
      'El backend nunca recibe datos de tarjeta.',
  })
  @Matches(/^(tkn|crd|ype)_(test|live)_[A-Za-z0-9_]+$/, {
    message: 'tokenId debe ser un token de Culqi (tkn_test_..., crd_... o ype_...)',
  })
  tokenId!: string;
}
