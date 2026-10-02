import { EventKind } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEventDto {
  @IsOptional() @IsEnum(EventKind)
  kind?: EventKind;

  @IsString() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @IsString()
  agenda?: string;
}

export class UpdateEventDto {
  @IsOptional() @IsEnum(EventKind)
  kind?: EventKind;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsOptional() @IsDateString()
  startsAt?: string;

  @IsOptional() @IsString()
  agenda?: string;

  @IsOptional() @IsString()
  decisions?: string;
}

export class AttendanceDto {
  @IsArray() @IsString({ each: true })
  presentMemberIds!: string[];
}
