/**
 * Événements récurrents (vérifié par `npm run check:recurrence`).
 * Toutes les heures sont celles du Cameroun : UTC+1 toute l'année (pas d'heure d'été).
 */
export type Frequency = 'WEEKLY' | 'MONTHLY_NTH' | 'MONTHLY_DAY';

export interface Recurrence {
  frequency: Frequency;
  /** 0 = dimanche … 6 = samedi (WEEKLY, MONTHLY_NTH). */
  weekday?: number | null;
  /** 1 à 4, ou -1 pour « le dernier » (MONTHLY_NTH). */
  nth?: number | null;
  /** Jour du mois 1-31 ; un mois plus court prend son dernier jour (MONTHLY_DAY). */
  monthDay?: number | null;
  /** Heure locale « HH:mm ». */
  time: string;
}

const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * OFFSET_MS;
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const ORDINALS: Record<number, string> = { 1: 'premier', 2: 'deuxième', 3: 'troisième', 4: 'quatrième', [-1]: 'dernier' };

/** Date locale (Cameroun) → instant UTC. month : 0-11. */
function localToUtc(year: number, month: number, day: number, time: string) {
  const [h, m] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month, day, h, m) - OFFSET_MS);
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Jour du mois de la règle pour un mois donné (null si ce mois n'en a pas, ex. pas de 5e vendredi). */
function dayInMonth(rule: Recurrence, year: number, month: number): number | null {
  const last = daysInMonth(year, month);
  if (rule.frequency === 'MONTHLY_DAY') return Math.min(rule.monthDay!, last);
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstMatch = 1 + ((rule.weekday! - firstWeekday + 7) % 7);
  if (rule.nth === -1) return firstMatch + 7 * Math.floor((last - firstMatch) / 7);
  const day = firstMatch + 7 * (rule.nth! - 1);
  return day <= last ? day : null;
}

/** Les dates de la règle comprises dans [from, to], dans l'ordre. */
export function occurrences(rule: Recurrence, from: Date, to: Date): Date[] {
  const result: Date[] = [];
  const local = new Date(from.getTime() + OFFSET_MS);
  if (rule.frequency === 'WEEKLY') {
    const delta = (rule.weekday! - local.getUTCDay() + 7) % 7;
    for (let d = local.getUTCDate() + delta; ; d += 7) {
      const at = localToUtc(local.getUTCFullYear(), local.getUTCMonth(), d, rule.time);
      if (at > to) break;
      if (at >= from) result.push(at);
    }
    return result;
  }
  for (let y = local.getUTCFullYear(), m = local.getUTCMonth(); ; m === 11 ? ((m = 0), y++) : m++) {
    if (localToUtc(y, m, 1, '00:00') > to) break;
    const day = dayInMonth(rule, y, m);
    if (day == null) continue;
    const at = localToUtc(y, m, day, rule.time);
    if (at >= from && at <= to) result.push(at);
  }
  return result;
}

/** Vérifie et complète une règle envoyée par le formulaire. */
export function validRecurrence(input: Partial<Recurrence> | undefined, time: string): Recurrence | null {
  if (!input?.frequency) return null;
  const ok =
    /^\d{2}:\d{2}$/.test(time) &&
    (input.frequency === 'WEEKLY'
      ? Number.isInteger(input.weekday) && input.weekday! >= 0 && input.weekday! <= 6
      : input.frequency === 'MONTHLY_NTH'
        ? Number.isInteger(input.weekday) && input.weekday! >= 0 && input.weekday! <= 6 && [1, 2, 3, 4, -1].includes(input.nth!)
        : input.frequency === 'MONTHLY_DAY' && Number.isInteger(input.monthDay) && input.monthDay! >= 1 && input.monthDay! <= 31);
  if (!ok) throw new Error('Règle de répétition invalide.');
  return { frequency: input.frequency, weekday: input.weekday ?? null, nth: input.nth ?? null, monthDay: input.monthDay ?? null, time };
}

/** Heure locale « HH:mm » d'un instant. */
export const localTime = (at: Date) => new Date(at.getTime() + OFFSET_MS).toISOString().slice(11, 16);

/** « chaque dernier vendredi du mois à 22h00 ». */
export function describe(rule: Recurrence) {
  const time = rule.time.replace(':', 'h');
  if (rule.frequency === 'WEEKLY') return `chaque ${WEEKDAYS[rule.weekday!]} à ${time}`;
  if (rule.frequency === 'MONTHLY_NTH') return `chaque ${ORDINALS[rule.nth!]} ${WEEKDAYS[rule.weekday!]} du mois à ${time}`;
  return `chaque mois le ${rule.monthDay === 1 ? '1er' : rule.monthDay} à ${time}`;
}

/** Les dates sont créées sur ce délai à l'avance (au moins la prochaine), puis prolongées chaque jour. */
export const HORIZON_MS = 31 * DAY_MS;
