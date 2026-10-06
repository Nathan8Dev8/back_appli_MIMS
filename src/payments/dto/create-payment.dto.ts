import { IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaymentMethod, PaymentNature } from '@prisma/client';

export class CreatePaymentDto {
  @IsString()
  memberId!: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Nature de l'entrée ; COTISATION par défaut (compatibilité avec l'existant). */
  @IsOptional()
  @IsEnum(PaymentNature)
  nature?: PaymentNature;

  /** Obligatoire pour une contribution à une collecte. */
  @IsOptional()
  @IsString()
  collecteId?: string;

  /** Date réelle du versement (par défaut : maintenant). Jamais dans le futur. */
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  /** Ignoré : un encaissement est toujours validé avec son reçu. Gardé pour ne pas refuser les anciens appels. */
  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;
}
