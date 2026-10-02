import { IsArray, IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** Les questions sont vérifiées en détail par validateQuestions (quiz-rules.ts). */
export class CreateQuizDto {
  @IsString() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  comment?: string;

  @IsArray()
  questions!: unknown[];

  @IsOptional() @IsDateString()
  closesAt?: string;
}

export class SetResultDto {
  @IsString()
  questionId!: string;

  @IsBoolean()
  correct!: boolean;
}
