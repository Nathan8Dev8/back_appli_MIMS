import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { CancelExpenseDto, CreateExpenseDto } from './dto/create-expense.dto';
import { CreateCollecteDto } from './dto/create-collecte.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { REMINDER_TITLE, debtReminder } from './reminder-messages';
import { computeCashTotals } from './cash';
import { resolveOperationDate } from './operation-date';
import {
  MONTHLY_DUE_AMOUNT,
  buildCotisationPlan,
  firstOfMonthUtc,
  firstOwedMonth,
  lastOverdueMonth,
  monthKey,
} from '../payments/cotisation-allocation';

export const PAYMENT_NATURES = ['INSCRIPTION', 'COTISATION', 'COLLECTE'] as const;
export const EXPENSE_NATURES = ['REMISE_COLLECTE', 'FONCTIONNEMENT', 'ACTIVITE', 'AUTRE_DEPENSE'] as const;
export const ALL_NATURES = [...PAYMENT_NATURES, ...EXPENSE_NATURES] as const;
export type TxNature = (typeof ALL_NATURES)[number];
export type TxDirection = 'ENTREE' | 'SORTIE';
export type TxStatus = 'VALIDE' | 'ANNULE' | 'EN_ATTENTE';

export interface TransactionFilter {
  direction?: TxDirection;
  nature?: TxNature;
  status?: TxStatus;
  from?: Date; // inclus
  to?: Date; // exclu
  q?: string;
}

export interface TransactionRow {
  id: string;
  kind: 'PAYMENT' | 'EXPENSE';
  reference: string;
  date: Date;
  direction: TxDirection;
  nature: TxNature;
  /** Ligne principale : le membre pour une entrée, le motif pour une sortie. */
  label: string;
  /** Précision : mois couverts, collecte concernée… */
  detail: string | null;
  memberId: string | null;
  amount: number;
  method: string;
  status: TxStatus;
  note: string | null;
  enteredByName: string;
  receiptId: string | null;
  cancelReason: string | null;
}

const fullName = (m?: { firstName: string; lastName: string } | null) => (m ? `${m.firstName} ${m.lastName}` : '—');
const monthLabel = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });

@Injectable()
export class FinanceService {
  private remindersRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ————————————————————————————————————————————————————————————
  // Tableau de bord de la caisse
  // ————————————————————————————————————————————————————————————

  async summary() {
    const now = new Date();
    const monthStart = firstOfMonthUtc(now);
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [totals, monthEntries, monthExits, entriesByNature, exitsByCategory, debts, collectes] = await Promise.all([
      computeCashTotals(this.prisma),
      this.prisma.payment.aggregate({
        where: { status: 'VALIDE', amount: { gt: 0 }, paidAt: { gte: monthStart, lt: nextMonthStart } },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { status: 'VALIDE', spentAt: { gte: monthStart, lt: nextMonthStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['nature'],
        where: { status: 'VALIDE', amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({ by: ['category'], where: { status: 'VALIDE' }, _sum: { amount: true } }),
      this.prisma.monthlyDue.groupBy({
        by: ['memberId'],
        where: {
          status: { in: ['A_PAYER', 'PARTIEL'] },
          dueMonth: { lte: lastOverdueMonth(now) },
          member: { status: { not: 'DEMISSIONNAIRE' } },
        },
        _sum: { balance: true },
      }),
      this.listCollectes(),
    ]);

    const debtors = debts.filter((d) => (d._sum.balance ?? 0) > 0);
    return {
      balance: totals.balance,
      totalEntries: totals.totalEntries,
      totalExits: totals.totalExits,
      monthEntries: monthEntries._sum.amount ?? 0,
      monthExits: monthExits._sum.amount ?? 0,
      entriesByNature: Object.fromEntries(entriesByNature.map((g) => [g.nature, g._sum.amount ?? 0])),
      exitsByCategory: Object.fromEntries(exitsByCategory.map((g) => [g.category, g._sum.amount ?? 0])),
      arrears: {
        total: debtors.reduce((s, d) => s + (d._sum.balance ?? 0), 0),
        debtors: debtors.length,
      },
      // Part du solde qui appartient déjà à des collectes ouvertes (à reverser).
      earmarkedForCollectes: collectes
        .filter((c) => c.status === 'OUVERTE')
        .reduce((s, c) => s + Math.max(c.remaining, 0), 0),
      currentMonth: monthStart,
    };
  }

  /** Situation de chaque membre : dettes, avances, dernier versement, inscription. */
  async membersStatus() {
    const monthStart = firstOfMonthUtc(new Date());
    const overdueUpTo = lastOverdueMonth();
    const [members, dues, lastPayments, inscriptions] = await Promise.all([
      this.prisma.member.findMany({
        where: { status: { not: 'DEMISSIONNAIRE' } },
        select: {
          id: true,
          memberCode: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatarUrl: true,
          status: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.monthlyDue.findMany({
        where: { status: { not: 'ANNULE' } },
        select: { memberId: true, dueMonth: true, amountPaid: true, balance: true },
      }),
      this.prisma.payment.groupBy({
        by: ['memberId'],
        where: { status: 'VALIDE', amount: { gt: 0 } },
        _max: { paidAt: true },
      }),
      this.prisma.payment.findMany({
        where: { nature: 'INSCRIPTION', status: 'VALIDE', amount: { gt: 0 } },
        select: { memberId: true },
      }),
    ]);

    const lastPaymentByMember = new Map(lastPayments.map((p) => [p.memberId, p._max.paidAt]));
    const registered = new Set(inscriptions.map((i) => i.memberId));
    const duesByMember = new Map<string, typeof dues>();
    for (const due of dues) {
      const list = duesByMember.get(due.memberId);
      if (list) list.push(due);
      else duesByMember.set(due.memberId, [due]);
    }

    const rows = members.map((member) => {
      let monthsLate = 0;
      let totalDebt = 0;
      let advanceCredit = 0;
      let advanceMonths = 0;
      for (const due of duesByMember.get(member.id) ?? []) {
        // En retard : mois dont le 2e dimanche est passé. Avance : mois futurs.
        // Le mois en cours, avant son 2e dimanche, n'est ni l'un ni l'autre.
        if (due.dueMonth.getTime() <= overdueUpTo.getTime()) {
          if (due.balance > 0) {
            monthsLate += 1;
            totalDebt += due.balance;
          }
        } else if (due.dueMonth.getTime() > monthStart.getTime()) {
          advanceCredit += due.amountPaid;
          if (due.balance <= 0) advanceMonths += 1;
        }
      }
      return {
        ...member,
        monthsLate,
        totalDebt,
        advanceCredit,
        advanceMonths,
        lastPaymentAt: lastPaymentByMember.get(member.id) ?? null,
        inscriptionPaid: registered.has(member.id),
        situation: totalDebt > 0 ? ('EN_DETTE' as const) : ('A_JOUR' as const),
      };
    });

    // Les plus endettés d'abord, puis ordre alphabétique (déjà appliqué par la requête).
    return rows.sort((a, b) => b.totalDebt - a.totalDebt);
  }

  /** Aperçu de la répartition d'un versement de cotisation, avant de l'enregistrer. */
  async cotisationPreview(memberId: string, amount: number, paidAtInput?: string) {
    if (!Number.isInteger(amount) || amount < 1) throw new BadRequestException('Montant invalide.');
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Membre introuvable.');

    const paidAt = resolveOperationDate(paidAtInput, new Date());
    const refMonth = firstOfMonthUtc(paidAt);
    const [steps, dues] = await Promise.all([
      buildCotisationPlan(this.prisma, memberId, amount, paidAt),
      this.prisma.monthlyDue.findMany({
        where: { memberId, status: { not: 'ANNULE' } },
        select: { dueMonth: true, balance: true },
      }),
    ]);

    const owed = dues.filter((d) => d.dueMonth.getTime() <= refMonth.getTime());
    const currentExists = dues.some((d) => monthKey(d.dueMonth) === monthKey(refMonth));
    const owedSum = owed.reduce((s, d) => s + d.balance, 0);
    const settledOnExisting = steps
      .filter((s) => !s.isNew && s.dueMonth.getTime() <= refMonth.getTime())
      .reduce((s, st) => s + st.amount, 0);
    const newDebt = steps
      .filter((s) => s.isNew && s.dueMonth.getTime() <= refMonth.getTime())
      .reduce((s, st) => s + st.balanceAfter, 0);

    return {
      paidAt,
      steps: steps.map((s) => ({
        month: s.dueMonth,
        label: monthLabel(s.dueMonth),
        kind: s.kind,
        amount: s.amount,
        balanceAfter: s.balanceAfter,
      })),
      // Le mois du versement n'est dû que si le membre était déjà arrivé à son 2e dimanche.
      debtBefore: owedSum + (currentExists || refMonth.getTime() < firstOwedMonth(member.joinedAt).getTime() ? 0 : MONTHLY_DUE_AMOUNT),
      debtAfter: owedSum - settledOnExisting + newDebt,
      advanceAmount: steps.filter((s) => s.kind === 'AVANCE').reduce((s, st) => s + st.amount, 0),
    };
  }

  // ————————————————————————————————————————————————————————————
  // Historique des transactions
  // ————————————————————————————————————————————————————————————

  /** Toutes les opérations correspondant au filtre, de la plus récente à la plus ancienne. */
  async allTransactions(filter: TransactionFilter): Promise<TransactionRow[]> {
    const wantPayments =
      filter.direction !== 'SORTIE' && (!filter.nature || (PAYMENT_NATURES as readonly string[]).includes(filter.nature));
    const wantExpenses =
      filter.direction !== 'ENTREE' &&
      filter.status !== 'EN_ATTENTE' &&
      (!filter.nature || (EXPENSE_NATURES as readonly string[]).includes(filter.nature));

    const tokens = (filter.q ?? '').trim().split(/\s+/).filter(Boolean);
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

    const paymentWhere: Prisma.PaymentWhereInput = {
      amount: { gt: 0 }, // les contre-passations (négatives) sont retracées via l'opération d'origine annulée
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.nature ? { nature: filter.nature as (typeof PAYMENT_NATURES)[number] } : {}),
      ...(filter.from || filter.to ? { paidAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
      ...(tokens.length
        ? {
            AND: tokens.map((t) => ({
              OR: [
                { paymentRef: contains(t) },
                { note: contains(t) },
                { collecte: { title: contains(t) } },
                { member: { OR: [{ firstName: contains(t) }, { lastName: contains(t) }, { memberCode: contains(t) }] } },
              ],
            })),
          }
        : {}),
    };

    const expenseWhere: Prisma.ExpenseWhereInput = {
      ...(filter.status && filter.status !== 'EN_ATTENTE' ? { status: filter.status } : {}),
      ...(filter.nature ? { category: filter.nature as (typeof EXPENSE_NATURES)[number] } : {}),
      ...(filter.from || filter.to ? { spentAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
      ...(tokens.length
        ? {
            AND: tokens.map((t) => ({
              OR: [
                { expenseRef: contains(t) },
                { label: contains(t) },
                { note: contains(t) },
                { collecte: { title: contains(t) } },
              ],
            })),
          }
        : {}),
    };

    const [payments, expenses] = await Promise.all([
      wantPayments
        ? this.prisma.payment.findMany({
            where: paymentWhere,
            include: {
              member: { select: { firstName: true, lastName: true } },
              enteredBy: { select: { firstName: true, lastName: true } },
              collecte: { select: { title: true } },
              receipt: { select: { id: true } },
              allocations: { include: { due: { select: { dueMonth: true } } } },
            },
          })
        : [],
      wantExpenses
        ? this.prisma.expense.findMany({
            where: expenseWhere,
            include: {
              enteredBy: { select: { firstName: true, lastName: true } },
              collecte: { select: { title: true } },
            },
          })
        : [],
    ]);

    const rows: TransactionRow[] = [];

    for (const p of payments) {
      let detail: string | null = null;
      if (p.nature === 'COTISATION') {
        detail = p.allocations.length
          ? p.allocations
              .map((a) => a.due.dueMonth)
              .sort((x, y) => x.getTime() - y.getTime())
              .map(monthLabel)
              .join(', ')
          : null;
      } else if (p.nature === 'INSCRIPTION') detail = "Frais d'inscription";
      else detail = p.collecte?.title ?? null;
      rows.push({
        id: p.id,
        kind: 'PAYMENT',
        reference: p.paymentRef,
        date: p.paidAt,
        direction: 'ENTREE',
        nature: p.nature,
        label: fullName(p.member),
        detail,
        memberId: p.memberId,
        amount: p.amount,
        method: p.method,
        status: p.status,
        note: p.note,
        enteredByName: fullName(p.enteredBy),
        receiptId: p.receipt?.id ?? null,
        cancelReason: null,
      });
    }

    for (const e of expenses) {
      rows.push({
        id: e.id,
        kind: 'EXPENSE',
        reference: e.expenseRef,
        date: e.spentAt,
        direction: 'SORTIE',
        nature: e.category,
        label: e.label,
        detail: e.collecte?.title ?? null,
        memberId: null,
        amount: e.amount,
        method: e.method,
        status: e.status,
        note: e.note,
        enteredByName: fullName(e.enteredBy),
        receiptId: null,
        cancelReason: e.cancelReason,
      });
    }

    return rows.sort((a, b) => b.date.getTime() - a.date.getTime() || b.reference.localeCompare(a.reference));
  }

  async transactions(filter: TransactionFilter, page: number, pageSize: number) {
    const rows = await this.allTransactions(filter);
    const valid = rows.filter((r) => r.status === 'VALIDE');
    const totalEntries = valid.filter((r) => r.direction === 'ENTREE').reduce((s, r) => s + r.amount, 0);
    const totalExits = valid.filter((r) => r.direction === 'SORTIE').reduce((s, r) => s + r.amount, 0);
    const safePage = Math.max(1, page);
    return {
      items: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
      total: rows.length,
      page: safePage,
      pageSize,
      // Totaux sur l'ensemble du filtre (pas seulement la page), opérations validées uniquement.
      totals: { entries: totalEntries, exits: totalExits, net: totalEntries - totalExits },
    };
  }

  // ————————————————————————————————————————————————————————————
  // Rappel aux membres en retard
  // ————————————————————————————————————————————————————————————

  /** Un membre déjà relancé depuis moins de 24 h n'est pas relancé une seconde fois. */
  private static readonly REMINDER_COOLDOWN_MS = 24 * 3600 * 1000;

  private async reminderTargets() {
    const debtors = (await this.membersStatus()).filter((m) => m.totalDebt > 0);
    const since = new Date(Date.now() - FinanceService.REMINDER_COOLDOWN_MS);
    const recent = debtors.length
      ? await this.prisma.notification.findMany({
          where: { type: 'RELANCE_DETTE', memberId: { in: debtors.map((d) => d.id) }, createdAt: { gte: since } },
          select: { memberId: true },
        })
      : [];
    const recentIds = new Set(recent.map((r) => r.memberId));
    const toSend = debtors.filter((d) => !recentIds.has(d.id));
    return { debtors, toSend, skipped: debtors.length - toSend.length };
  }

  /** Ce que ferait l'envoi, sans rien envoyer : pour que la trésorière confirme en connaissance de cause. */
  async reminderPreview() {
    const { debtors, toSend, skipped } = await this.reminderTargets();
    // Ceux qui ont activé les notifications reçoivent aussi une alerte sur leur téléphone.
    const devices = toSend.length
      ? await this.prisma.pushSubscription.groupBy({ by: ['memberId'], where: { memberId: { in: toSend.map((m) => m.id) } } })
      : [];
    const sample = toSend[0] ?? debtors[0];
    return {
      debtors: debtors.length,
      toSend: toSend.length,
      skipped,
      withPush: devices.length,
      sample: sample ? { firstName: sample.firstName, message: debtReminder(sample.firstName, sample.totalDebt, sample.monthsLate) } : null,
    };
  }

  /**
   * Envoie le rappel dans les notifications de chaque membre en retard. Le
   * message est visible dans l'appli dès qu'il est enregistré ; l'alerte sur
   * le téléphone (push) s'y ajoute pour ceux qui l'ont activée.
   */
  async sendReminders(actorId: string) {
    if (this.remindersRunning) throw new BadRequestException("Un rappel est déjà en cours d'envoi, patiente un instant.");
    this.remindersRunning = true;
    try {
      const { debtors, toSend, skipped } = await this.reminderTargets();
      const result = { debtors: debtors.length, skipped, sent: 0, failed: 0, pushed: 0 };

      for (const member of toSend) {
        try {
          const notification = await this.notifications.notifyMember(
            member.id,
            'RELANCE_DETTE',
            REMINDER_TITLE,
            debtReminder(member.firstName, member.totalDebt, member.monthsLate),
            '/cotisations',
          );
          result.sent += 1;
          if (notification.status === 'ENVOYE') result.pushed += 1;
        } catch {
          result.failed += 1;
        }
      }

      await this.audit.log({ actorId, action: 'SEND_DEBT_REMINDERS', entityType: 'Notification', entityId: 'bulk', after: result });
      return result;
    } finally {
      this.remindersRunning = false;
    }
  }

  // ————————————————————————————————————————————————————————————
  // Sorties de caisse
  // ————————————————————————————————————————————————————————————

  async createExpense(dto: CreateExpenseDto, actorId: string) {
    let collecteId: string | undefined;
    if (dto.category === 'REMISE_COLLECTE' && !dto.collecteId) {
      throw new BadRequestException('Choisis la collecte que tu remets.');
    }
    if (dto.collecteId) {
      const collecte = await this.prisma.collecte.findUnique({ where: { id: dto.collecteId } });
      if (!collecte) throw new NotFoundException('Collecte introuvable.');
      collecteId = collecte.id;
    }

    const { balance } = await computeCashTotals(this.prisma);
    if (dto.amount > balance) {
      throw new BadRequestException(
        `Solde insuffisant : il y a ${balance.toLocaleString('fr-FR')} FCFA en caisse, la sortie demandée est de ${dto.amount.toLocaleString('fr-FR')} FCFA.`,
      );
    }

    const expense = await this.prisma.expense.create({
      data: {
        expenseRef: `SRT-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        amount: dto.amount,
        category: dto.category,
        label: dto.label.trim(),
        method: dto.method,
        spentAt: resolveOperationDate(dto.spentAt, new Date()),
        collecteId,
        note: dto.note?.trim() || undefined,
        enteredById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'CREATE_EXPENSE', entityType: 'Expense', entityId: expense.id, after: expense });
    return expense;
  }

  async cancelExpense(id: string, dto: CancelExpenseDto, actorId: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Sortie introuvable.');
    if (expense.status === 'ANNULE') throw new BadRequestException('Cette sortie est déjà annulée.');

    const updated = await this.prisma.expense.update({
      where: { id },
      data: { status: 'ANNULE', cancelReason: dto.reason.trim(), cancelledAt: new Date() },
    });
    await this.audit.log({
      actorId,
      action: 'CANCEL_EXPENSE',
      entityType: 'Expense',
      entityId: id,
      before: { status: 'VALIDE' },
      after: { status: 'ANNULE', reason: dto.reason },
    });
    return updated;
  }

  // ————————————————————————————————————————————————————————————
  // Collectes (mariage, naissance, deuil…)
  // ————————————————————————————————————————————————————————————

  async listCollectes() {
    const [collectes, collected, remitted] = await Promise.all([
      this.prisma.collecte.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.groupBy({
        by: ['collecteId'],
        where: { collecteId: { not: null }, status: 'VALIDE', amount: { gt: 0 } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ['collecteId'],
        where: { collecteId: { not: null }, status: 'VALIDE' },
        _sum: { amount: true },
      }),
    ]);
    const collectedBy = new Map(collected.map((g) => [g.collecteId, g]));
    const remittedBy = new Map(remitted.map((g) => [g.collecteId, g._sum.amount ?? 0]));

    return collectes
      .map((c) => {
        const total = collectedBy.get(c.id)?._sum.amount ?? 0;
        const out = remittedBy.get(c.id) ?? 0;
        return {
          ...c,
          collected: total,
          contributors: collectedBy.get(c.id)?._count._all ?? 0,
          remitted: out,
          remaining: total - out,
        };
      })
      .sort((a, b) => Number(a.status === 'CLOTUREE') - Number(b.status === 'CLOTUREE'));
  }

  async getCollecte(id: string) {
    const collecte = await this.prisma.collecte.findUnique({ where: { id } });
    if (!collecte) throw new NotFoundException('Collecte introuvable.');
    const [contributions, remittances] = await Promise.all([
      this.prisma.payment.findMany({
        where: { collecteId: id, status: 'VALIDE', amount: { gt: 0 } },
        include: { member: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { paidAt: 'desc' },
      }),
      this.prisma.expense.findMany({ where: { collecteId: id, status: 'VALIDE' }, orderBy: { spentAt: 'desc' } }),
    ]);
    return {
      ...collecte,
      contributions: contributions.map((p) => ({
        id: p.id,
        memberName: fullName(p.member),
        amount: p.amount,
        method: p.method,
        paidAt: p.paidAt,
      })),
      remittances: remittances.map((e) => ({ id: e.id, label: e.label, amount: e.amount, spentAt: e.spentAt })),
    };
  }

  async createCollecte(dto: CreateCollecteDto, actorId: string) {
    const collecte = await this.prisma.collecte.create({
      data: {
        title: dto.title.trim(),
        kind: dto.kind,
        beneficiary: dto.beneficiary?.trim() || undefined,
        description: dto.description?.trim() || undefined,
        createdById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'CREATE_COLLECTE', entityType: 'Collecte', entityId: collecte.id, after: collecte });
    return collecte;
  }

  async closeCollecte(id: string, actorId: string) {
    const collecte = await this.prisma.collecte.findUnique({ where: { id } });
    if (!collecte) throw new NotFoundException('Collecte introuvable.');
    if (collecte.status === 'CLOTUREE') throw new BadRequestException('Cette collecte est déjà clôturée.');
    const closed = await this.prisma.collecte.update({ where: { id }, data: { status: 'CLOTUREE', closedAt: new Date() } });
    await this.audit.log({
      actorId,
      action: 'CLOSE_COLLECTE',
      entityType: 'Collecte',
      entityId: id,
      before: { status: 'OUVERTE' },
      after: { status: 'CLOTUREE' },
    });
    return closed;
  }
}
