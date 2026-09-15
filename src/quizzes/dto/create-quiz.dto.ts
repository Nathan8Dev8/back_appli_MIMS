import { IsArray, IsOptional, IsString } from 'class-validator';

export class QuizQuestionDto {
  id!: string;
  question!: string;
  choices!: string[];
  correctIndex!: number;
}

export class CreateQuizDto {
  @IsString()
  title!: string;

  @IsArray()
  questions!: QuizQuestionDto[];

  @IsOptional() @IsString()
  closesAt?: string;
}
