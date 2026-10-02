import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Date d'une opération de caisse : « maintenant » par défaut, jamais dans le
 * futur. Un jour de marge évite de refuser « aujourd'hui » saisi depuis un
 * fuseau en avance sur l'UTC ; la date du jour retombe alors sur l'instant présent.
 */
export function resolveOperationDate(input: string | undefined, now: Date) {
  if (!input) return now;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("Date de l'opération invalide.");
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() >= startOfTodayUtc + 2 * DAY_MS) {
    throw new BadRequestException("La date de l'opération ne peut pas être dans le futur.");
  }
  return date.getTime() >= startOfTodayUtc ? now : date;
}
