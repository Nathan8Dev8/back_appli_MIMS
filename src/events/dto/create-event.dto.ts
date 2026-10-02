import { EventKind } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEventDto {
  @IsOptional() @IsEnum(EventKind)
  kind?: EventKind;

  @IsString() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  location?: string;

  /** Coordonnées GPS du lieu ; null pour les effacer. */
  @IsOptional() @IsLatitude()
  latitude?: number | null;

  @IsOptional() @IsLongitude()
  longitude?: number | null;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @IsString()
  agenda?: string;

  /** Répétition : { frequency, weekday?, nth?, monthDay?, until? } — vérifiée par validRecurrence. */
  @IsOptional() @IsObject()
  repeat?: { frequency: 'WEEKLY' | 'MONTHLY_NTH' | 'MONTHLY_DAY'; weekday?: number; nth?: number; monthDay?: number; until?: string };
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

  /** Coordonnées GPS du lieu ; null pour les effacer. */
  @IsOptional() @IsLatitude()
  latitude?: number | null;

  @IsOptional() @IsLongitude()
  longitude?: number | null;

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
