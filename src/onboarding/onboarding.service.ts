import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit/audit.service';

/**
 * Intégration d'un nouveau membre :
 * 1. à la création du compte, il reçoit automatiquement le mot de bienvenue et le règlement ;
 * 2. à sa première connexion, l'écran « Bienvenue » lui fait vérifier son profil,
 *    activer les notifications et accepter le règlement ;
 * 3. le bureau voit qui n'a pas terminé et peut le relancer.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private currentRegulation() {
    return this.prisma.document.findFirst({
      where: { type: 'REGLEMENT', status: 'PUBLIE' },
      orderBy: [{ documentDate: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
      select: { id: true, title: true, documentCode: true },
    });
  }

  /** Appelé à la création du compte. */
  async start(memberId: string) {
    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    const regulation = await this.currentRegulation();

    await this.notifications.notifyMember(
      memberId,
      'BIENVENUE',
      'Bienvenue chez les Jeunes MIMS 👋',
      `${member.firstName}, content de t'avoir avec nous ! Ton espace est prêt : prends 2 minutes pour finir ton inscription.`,
      '/bienvenue',
    );
    if (regulation) {
      await this.notifications.notifyMember(
        memberId,
        'AUTRE',
        'Le règlement intérieur',
        'Lis le règlement intérieur du groupe puis confirme-le depuis ton écran de bienvenue.',
        '/bienvenue',
      );
    }

    const data = {
      status: regulation ? ('REGLEMENT_ENVOYE' as const) : ('BIENVENUE_ENVOYEE' as const),
      welcomeSentAt: new Date(),
      ...(regulation ? { regulationDocumentId: regulation.id, regulationSentAt: new Date() } : {}),
    };
    return this.prisma.onboarding.upsert({ where: { memberId }, update: data, create: { memberId, ...data } });
  }

  /** Ce que l'écran de bienvenue affiche. Les anciens comptes sans fiche d'intégration en reçoivent une. */
  async mine(memberId: string) {
    const onboarding = await this.prisma.onboarding.upsert({ where: { memberId }, update: {}, create: { memberId } });
    return { status: onboarding.status, completedAt: onboarding.completedAt, regulation: await this.currentRegulation() };
  }

  async complete(memberId: string) {
    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { birthDate: true } });
    if (!member.birthDate) throw new BadRequestException("Ajoute d'abord ta date de naissance.");
    const regulation = await this.currentRegulation();
    const onboarding = await this.prisma.onboarding.upsert({
      where: { memberId },
      update: { status: 'TERMINE', completedAt: new Date(), regulationDocumentId: regulation?.id },
      create: { memberId, status: 'TERMINE', completedAt: new Date(), regulationDocumentId: regulation?.id },
    });
    await this.audit.log({
      actorId: memberId,
      action: 'ONBOARDING_COMPLETED',
      entityType: 'Member',
      entityId: memberId,
      after: { regulationDocumentId: regulation?.id ?? null },
    });
    return onboarding;
  }

  async remind(memberId: string, actorId: string) {
    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    await this.notifications.notifyMember(
      memberId,
      'AUTRE',
      'Ton inscription n’est pas terminée',
      `${member.firstName}, il te reste une petite étape : lire et accepter le règlement du groupe.`,
      '/bienvenue',
    );
    await this.audit.log({ actorId, action: 'ONBOARDING_REMINDER', entityType: 'Member', entityId: memberId });
    return { ok: true };
  }
}
