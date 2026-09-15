import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async monthlyFinance(year: number) {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: 'VALIDE',
        paidAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
    });

    const byMonth = Array.from({ length: 12 }, (_, month) => ({ month: month + 1, total: 0, count: 0 }));
    for (const p of payments) {
      const m = p.paidAt.getUTCMonth();
      byMonth[m].total += p.amount;
      byMonth[m].count += 1;
    }

    const dues = await this.prisma.monthlyDue.aggregate({
      where: { dueMonth: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      _sum: { amountDue: true, amountPaid: true, balance: true },
    });

    return {
      year,
      byMonth,
      totalCollected: byMonth.reduce((s, m) => s + m.total, 0),
      totalDue: dues._sum.amountDue ?? 0,
      totalOutstanding: dues._sum.balance ?? 0,
    };
  }
}
