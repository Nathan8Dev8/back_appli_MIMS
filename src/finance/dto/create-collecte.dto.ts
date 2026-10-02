import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CollecteKind } from '@prisma/client';

export class CreateCollecteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsEnum(CollecteKind)
  kind!: CollecteKind;

  /** Personne concernée par l'événement (mariés, parents, famille endeuillée…). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  beneficiary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
