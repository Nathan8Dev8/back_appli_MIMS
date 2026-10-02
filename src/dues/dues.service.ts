import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MONTHLY_DUE_AMOUNT, firstOfMonthUtc, firstOwedMonth, secondSundayUtc } from '../payments/cotisation-allocation';

@Injectable()
export class DuesService {
  private readonly logger = new Logger(DuesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée l'échéance de 500 FCFA du mois, à régler le 2e dimanche, pour chaque
   * membre actif qui la doit (arrivé au plus tard ce dimanche-là).
   * `memberId` limite la création à un seul membre (nouvel inscrit).
   */
  async generateForMonth(reference: Date = new Date(), memberId?: string) {
    const dueMonth = firstOfMonthUtc(reference);
    const dueDate = secondSundayUtc(dueMonth);

    const members = await this.prisma.member.findMany({
      where: { status: 'ACTIF', ...(memberId ? { id: memberId } : {}) },
      select: { id: true, joinedAt: true },
    });
    let created = 0;
    for (const member of members) {
      if (firstOwedMonth(member.joinedAt).getTime() > dueMonth.getTime()) continue;
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
}
