import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export const MONTHLY_DUE_AMOUNT = 500; // FCFA — cf. cahier des charges §7

function firstOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

@Injectable()
export class DuesService {
  private readonly logger = new Logger(DuesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** MonthlyDueJob — crée l'échéance de 500 FCFA pour chaque membre actif. */
  async generateForMonth(reference: Date = new Date()) {
    const dueMonth = firstOfMonth(reference);
    const dueDate = new Date(Date.UTC(dueMonth.getUTCFullYear(), dueMonth.getUTCMonth(), 10)); // échéance le 10

    const activeMembers = await this.prisma.member.findMany({ where: { status: 'ACTIF' } });
    let created = 0;
    for (const member of activeMembers) {
      const exists = await this.prisma.monthlyDue.findUnique({
        where: { memberId_dueMonth: { memberId: member.id, dueMonth } },
      });
      if (exists) continue;
      await this.prisma.monthlyDue.create({
        data: {
          memberId: member.id,
          dueMonth,
          amountDue: MONTHLY_DUE_AMOUNT,
          amountPaid: 0,
          balance: MONTHLY_DUE_AMOUNT,
          status: 'A_PAYER',
          dueDate,
        },
      });
      created += 1;
    }
    this.logger.log(`MonthlyDueJob : ${created} échéance(s) créée(s) pour ${dueMonth.toISOString().slice(0, 7)}.`);
    return { dueMonth, created };
  }

  async listForMember(memberId: string) {
    return this.prisma.monthlyDue.findMany({
      where: { memberId },
      orderBy: { dueMonth: 'desc' },
    });
  }

  async listAll(status?: string) {
    return this.prisma.monthlyDue.findMany({
      where: status ? { status: status as any } : {},
      include: { member: true },
      orderBy: { dueMonth: 'desc' },
    });
  }

  async debtSummary() {
    const unpaid = await this.prisma.monthlyDue.findMany({
      where: { status: { in: ['A_PAYER', 'PARTIEL'] } },
      include: { member: true },
    });
    const byMember = new Map<string, { member: any; monthsLate: number; totalDebt: number }>();
    for (const due of unpaid) {
      const entry = byMember.get(due.memberId) ?? { member: due.member, monthsLate: 0, totalDebt: 0 };
      entry.monthsLate += 1;
      entry.totalDebt += due.balance;
      byMember.set(due.memberId, entry);
    }
    return Array.from(byMember.values()).sort((a, b) => b.totalDebt - a.totalDebt);
  }
}
