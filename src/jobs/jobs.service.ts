import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { DuesService } from '../dues/dues.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Automatisations §6 du cahier des charges. Chaque job est aussi exposé
 * en service afin de pouvoir être déclenché manuellement (bouton admin)
 * sans attendre l'horaire cron — utile en développement et en recette.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dues: DuesService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 0 1 * *') // 1er du mois, 00:00
  async monthlyDueJob() {
    return this.dues.generateForMonth();
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async friendlyReminderJob() {
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const dues = await this.prisma.monthlyDue.findMany({
      where: {
        status: { in: ['A_PAYER', 'PARTIEL'] },
        dueDate: { gte: new Date(), lte: inThreeDays },
      },
      include: { member: true },
    });
    for (const due of dues) {
      await this.notifications.notifyMember(
        due.memberId,
        'RAPPEL_COTISATION',
        'Petit rappel amical',
        `Ta cotisation de ${due.balance.toLocaleString('fr-FR')} FCFA arrive à échéance le ${due.dueDate.toLocaleDateString('fr-FR')}. Merci pour ton engagement !`,
      );
    }
    this.logger.log(`FriendlyReminderJob : ${dues.length} rappel(s) envoyé(s).`);
  }

  @Cron(CronExpression.EVERY_WEEK)
  async debtReminderJob() {
    const debtors = await this.dues.debtSummary();
    const chronic = debtors.filter((d) => d.monthsLate >= 2);
    for (const debtor of chronic) {
      await this.notifications.notifyMember(
        debtor.member.id,
        'RELANCE_DETTE',
        'Régularisation de cotisation',
        `Tu comptes ${debtor.monthsLate} mois d'arriérés (${debtor.totalDebt.toLocaleString('fr-FR')} FCFA). Rapproche-toi du trésorier pour régulariser.`,
      );
    }
    this.logger.log(`DebtReminderJob : ${chronic.length} relance(s) envoyée(s).`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async birthdayJob() {
    const today = new Date();
    const members = await this.prisma.member.findMany({
      where: { status: 'ACTIF', birthDate: { not: null } },
    });
    const celebrants = members.filter(
      (m) => m.birthDate && m.birthDate.getUTCMonth() === today.getUTCMonth() && m.birthDate.getUTCDate() === today.getUTCDate(),
    );
    for (const member of celebrants) {
      await this.notifications.notifyMember(
        member.id,
        'ANNIVERSAIRE',
        'Joyeux anniversaire !',
        `${member.firstName}, toute la famille Jeunes MIMS te souhaite une année bénie et remplie de joie !`,
      );
    }
    this.logger.log(`BirthdayJob : ${celebrants.length} vœu(x) envoyé(s).`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async eventReminderJob() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
    const in2h = new Date(now.getTime() + 2 * 3600 * 1000);

    const upcoming = await this.prisma.event.findMany({
      where: { status: 'PLANIFIE', startsAt: { gte: now, lte: in24h } },
      include: { participations: true },
    });

    for (const event of upcoming) {
      const window = event.startsAt <= in2h ? '2h' : '24h';
      const targets = event.participations.filter((p) => p.response !== 'ABSENT');
      for (const participation of targets) {
        await this.notifications.notifyMember(
          participation.memberId,
          'EVENEMENT',
          `Ça approche : ${event.title}`,
          `Rendez-vous dans ${window} pour « ${event.title} »${event.location ? ` à ${event.location}` : ''}.`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async pollClosingJob() {
    const expired = await this.prisma.poll.findMany({
      where: { status: 'OUVERT', closesAt: { lte: new Date() } },
    });
    for (const poll of expired) {
      await this.prisma.poll.update({ where: { id: poll.id }, data: { status: 'CLOTURE' } });
    }
    if (expired.length) this.logger.log(`PollClosingJob : ${expired.length} sondage(s) clôturé(s).`);
  }
}
