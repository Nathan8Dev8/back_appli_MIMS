import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { RoleCode } from '@prisma/client';

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


  /**
   * Rôle additionnel à attribuer dès la création (en plus de MEMBRE).
   * Réservé au Président/Admin — voir MembersController.create.
   */
  @IsOptional() @IsEnum(RoleCode)
  role?: RoleCode;
}
