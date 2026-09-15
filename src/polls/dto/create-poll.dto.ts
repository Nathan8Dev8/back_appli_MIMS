import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreatePollDto {
  @IsString()
  title!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsBoolean()
  anonymous?: boolean;

  @IsOptional() @IsDateString()
  closesAt?: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'Un sondage doit proposer au moins deux options.' })
  options!: string[];
}
