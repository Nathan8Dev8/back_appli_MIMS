import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const MONTHLY_DUE_AMOUNT = 500; // FCFA — cotisation mensuelle de base
export const REGISTRATION_FEE = 1000; // FCFA — frais d'inscription de base
export const MAX_ADVANCE_MONTHS = 24; // garde-fou : on ne prépaie pas plus de 2 ans

export function firstOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addMonthsUtc(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

const DAY_MS = 24 * 3600 * 1000;

/** La cotisation d'un mois se paie le 2e dimanche de ce mois (jour de réunion du groupe). */
export function secondSundayUtc(month: Date) {
  const first = firstOfMonthUtc(month);
  const daysToFirstSunday = (7 - first.getUTCDay()) % 7;
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 + daysToFirstSunday + 7));
}

/** Un mois non payé devient une dette le lundi qui suit son 2e dimanche. */
export function isOverdue(dueMonth: Date, now = new Date()) {
  return now.getTime() >= secondSundayUtc(dueMonth).getTime() + DAY_MS;
}

/** Dernier mois déjà en retard s'il n'est pas payé (le mois en cours une fois son 2e dimanche passé). */
export function lastOverdueMonth(now = new Date()) {
  const month = firstOfMonthUtc(now);
  return isOverdue(month, now) ? month : addMonthsUtc(month, -1);
}

/** Un nouveau membre paie à partir du prochain 2e dimanche suivant son arrivée (le jour même compris). */
export function firstOwedMonth(joinedAt: Date) {
  const month = firstOfMonthUtc(joinedAt);
  return isOverdue(month, joinedAt) ? addMonthsUtc(month, 1) : month;
}

export function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Échéance existante d'un membre. Les échéances annulées sont passées avec un solde de 0. */
export interface DueSnapshot {
  id: string;
  dueMonth: Date;
  balance: number;
}

export type AllocationKind = 'MOIS_EN_COURS' | 'ARRIERE' | 'AVANCE';

export interface AllocationStep {
  /** null = l'échéance de ce mois n'existe pas encore et doit être créée. */
  dueId: string | null;
  dueMonth: Date;
  amount: number;
  kind: AllocationKind;
  /** Reste dû sur ce mois une fois le versement appliqué. */
  balanceAfter: number;
  isNew: boolean;
}

/**
 * Répartit un versement de cotisation, quel que soit son montant :
 *   1. il solde d'abord le mois du versement (500 FCFA de base) ; s'il est
 *      inférieur, le reste de ce mois devient une dette ;
 *   2. le surplus éponge ensuite les dettes des mois précédents, du plus
 *      ancien au plus récent ;
 *   3. s'il n'y a (plus) aucune dette, le surplus est compté d'avance pour
 *      les mois suivants.
 * Un mois antérieur à `firstMonth` (arrivée du membre) n'est jamais facturé.
 */
export function planCotisationAllocation(input: {
  amount: number;
  refMonth: Date;
  dues: DueSnapshot[];
  firstMonth?: Date;
}): AllocationStep[] {
  const { amount, refMonth, dues, firstMonth } = input;
  const byMonth = new Map(dues.map((d) => [monthKey(d.dueMonth), d]));
  const steps: AllocationStep[] = [];
  let remaining = amount;

  const pay = (month: Date, kind: AllocationKind) => {
    if (remaining <= 0 || (firstMonth && month.getTime() < firstMonth.getTime())) return;
    const existing = byMonth.get(monthKey(month));
    const balance = existing ? existing.balance : MONTHLY_DUE_AMOUNT;
    if (balance <= 0) return; // mois déjà réglé (ou annulé)
    const take = Math.min(remaining, balance);
    steps.push({
      dueId: existing?.id ?? null,
      dueMonth: month,
      amount: take,
      kind,
      balanceAfter: balance - take,
      isNew: !existing,
    });
    remaining -= take;
  };

  pay(refMonth, 'MOIS_EN_COURS');

  const arrears = dues
    .filter((d) => d.dueMonth.getTime() < refMonth.getTime() && d.balance > 0)
    .sort((a, b) => a.dueMonth.getTime() - b.dueMonth.getTime());
  for (const due of arrears) pay(due.dueMonth, 'ARRIERE');

  for (let i = 1; i <= MAX_ADVANCE_MONTHS && remaining > 0; i += 1) {
    pay(addMonthsUtc(refMonth, i), 'AVANCE');
  }

  if (remaining > 0) {
    throw new BadRequestException(
      `Ce montant est trop élevé : on ne peut pas payer plus de ${MAX_ADVANCE_MONTHS} mois d'avance.`,
    );
  }
  return steps;
}

/** Lit les échéances du membre et calcule la répartition d'un versement à la date donnée. */
export async function buildCotisationPlan(
  client: Prisma.TransactionClient,
  memberId: string,
  amount: number,
  paidAt: Date,
) {
  const [dues, member] = await Promise.all([
    client.monthlyDue.findMany({
      where: { memberId },
      select: { id: true, dueMonth: true, balance: true, status: true },
    }),
    client.member.findUniqueOrThrow({ where: { id: memberId }, select: { joinedAt: true } }),
  ]);
  return planCotisationAllocation({
    amount,
    refMonth: firstOfMonthUtc(paidAt),
    firstMonth: firstOwedMonth(member.joinedAt),
    dues: dues.map((d) => ({
      id: d.id,
      dueMonth: d.dueMonth,
      balance: d.status === 'ANNULE' ? 0 : d.balance,
    })),
  });
}
