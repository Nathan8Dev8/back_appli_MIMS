import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstOfMonthUtc, secondSundayUtc } from '../payments/cotisation-allocation';
import { PrismaService } from '../database/prisma.service';
import { DuesService } from '../dues/dues.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Automatisations §6 du cahier des charges. Chaque job est aussi exposé
 * en service afin de pouvoir être déclenché manuellement (bouton admin)
 * sans attendre l'horaire cron — utile en développement et en recette.
 */
// Heure du groupe (Cameroun, UTC+1) : les tâches partent à l'heure locale, quel que soit le fuseau du serveur.
const TIME_ZONE = 'Africa/Douala';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dues: DuesService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 0 1 * *', { timeZone: TIME_ZONE }) // 1er du mois, 00:00
  async monthlyDueJob() {
    return this.dues.generateForMonth();
  }

  /**
   * Rappel de cotisation, calé sur le jour de paiement (2e dimanche du mois) :
   * le jeudi d'avant (J-3) puis le matin même. Il annonce le total à régler :
   * le mois en cours plus les éventuels retards.
   */
  @Cron('0 7 * * *', { timeZone: TIME_ZONE })
  async cotisationReminderJob(now = new Date()) {
    const month = firstOfMonthUtc(now);
    const sunday = secondSundayUtc(month);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysBefore = Math.round((sunday.getTime() - today) / (24 * 3600 * 1000));
    if (daysBefore !== 3 && daysBefore !== 0) return;

    const unpaid = await this.prisma.monthlyDue.findMany({
      where: { status: { in: ['A_PAYER', 'PARTIEL'] }, dueMonth: { lte: month }, member: { status: 'ACTIF' } },
      select: { memberId: true, balance: true },
    });
    const owedByMember = new Map<string, number>();
    for (const due of unpaid) owedByMember.set(due.memberId, (owedByMember.get(due.memberId) ?? 0) + due.balance);

    const day = sunday.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    for (const [memberId, owed] of owedByMember) {
      if (owed <= 0) continue;
      const amount = `${owed.toLocaleString('fr-FR')} FCFA`;
      await this.notifications.notifyMember(
        memberId,
        'RAPPEL_COTISATION',
        daysBefore ? 'Cotisation dimanche' : "Cotisation aujourd'hui",
        daysBefore
          ? `Rendez-vous ${day} pour la cotisation : ${amount} à régler. Merci 🙏`
          : `C'est aujourd'hui, ${day} : pense à ta cotisation de ${amount}. Merci 🙏`,
        '/cotisations',
      );
    }
    this.logger.log(`Rappel de cotisation (J-${daysBefore}) : ${owedByMember.size} membre(s) concerné(s).`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: TIME_ZONE })
  async birthdayJob() {
    const today = new Date();
    const members = await this.prisma.member.findMany({
      where: { status: 'ACTIF', birthDate: { not: null } },
    });
    // Né un 29 février : fêté le 28 les années non bissextiles.
    const leapYear = new Date(Date.UTC(today.getUTCFullYear(), 1, 29)).getUTCMonth() === 1;
    const isToday = (b: Date) =>
      (b.getUTCMonth() === today.getUTCMonth() && b.getUTCDate() === today.getUTCDate()) ||
      (!leapYear && b.getUTCMonth() === 1 && b.getUTCDate() === 29 && today.getUTCMonth() === 1 && today.getUTCDate() === 28);
    const celebrants = members.filter((m) => m.birthDate && isToday(m.birthDate));
    for (const member of celebrants) {
      await this.notifications.notifyMember(
        member.id,
        'ANNIVERSAIRE',
        'Joyeux anniversaire 🎂',
        `${member.firstName}, tout le groupe Jeunes MIMS te souhaite un très bon anniversaire.`,
        '/tableau-de-bord',
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
          `Bientôt : ${event.title}`,
          `C'est dans ${window} : « ${event.title} »${event.location ? `, à ${event.location}` : ''}.`,
          `/evenements/${event.id}`,
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
