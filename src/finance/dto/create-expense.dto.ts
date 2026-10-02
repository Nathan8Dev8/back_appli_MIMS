import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ExpenseCategory, PaymentMethod } from '@prisma/client';

export class CreateExpenseDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  /** Motif de la sortie (obligatoire : c'est ce qui la rend traçable). */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  label!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** Obligatoire pour la remise d'une collecte. */
  @IsOptional()
  @IsString()
  collecteId?: string;

  @IsOptional()
  @IsISO8601()
  spentAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelExpenseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
