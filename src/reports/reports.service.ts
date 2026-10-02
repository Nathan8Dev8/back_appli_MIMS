import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async monthlyFinance(year: number) {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: 'VALIDE',
        amount: { gt: 0 }, // les contre-passations (montant négatif) ne comptent pas : l'original est déjà ANNULE
        paidAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
    });

    const expenses = await this.prisma.expense.findMany({
      where: { status: 'VALIDE', spentAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    });

    // total = entrées validées (cotisations, inscriptions, collectes) ; exits = sorties validées.
    const byMonth = Array.from({ length: 12 }, (_, month) => ({ month: month + 1, total: 0, count: 0, exits: 0 }));
    for (const p of payments) {
      const m = p.paidAt.getUTCMonth();
      byMonth[m].total += p.amount;
      byMonth[m].count += 1;
    }
    for (const e of expenses) byMonth[e.spentAt.getUTCMonth()].exits += e.amount;

    const dues = await this.prisma.monthlyDue.aggregate({
      where: { dueMonth: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      _sum: { amountDue: true, amountPaid: true, balance: true },
    });

    return {
      year,
      byMonth,
      totalCollected: byMonth.reduce((s, m) => s + m.total, 0),
      totalExits: byMonth.reduce((s, m) => s + m.exits, 0),
      totalDue: dues._sum.amountDue ?? 0,
      totalOutstanding: dues._sum.balance ?? 0,
    };
  }
}
