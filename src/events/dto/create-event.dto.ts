import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateEventDto {
  @IsString()
  title!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;
}
