import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PreferredChannel, RoleCode } from '@prisma/client';

export class CreateMemberDto {
  @IsString() @MinLength(2)
  firstName!: string;

  @IsString() @MinLength(2)
  lastName!: string;

  @IsString()
  phone!: string;

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

  /**
   * Rôle additionnel à attribuer dès la création (en plus de MEMBRE).
   * Réservé au Président/Admin — voir MembersController.create.
   */
  @IsOptional() @IsEnum(RoleCode)
  role?: RoleCode;
}
