import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PreferredChannel } from '@prisma/client';

/**
 * Auto-service : chaque membre peut mettre à jour ses propres informations
 * personnelles (hors statut, rôle, code membre — réservés à l'administration).
 */
export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(2)
  firstName?: string;

  @IsOptional() @IsString() @MinLength(2)
  lastName?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString()
  address?: string;

  @IsOptional() @IsString()
  birthDate?: string;

  @IsOptional() @IsBoolean()
  whatsappActive?: boolean;

  @IsOptional() @IsEnum(PreferredChannel)
  preferredChannel?: PreferredChannel;
}
