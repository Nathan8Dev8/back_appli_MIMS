import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  list() {
    return this.prisma.onboarding.findMany({ include: { member: true }, orderBy: { status: 'asc' } });
  }

  async sendWelcome(memberId: string) {
    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    await this.notifications.notifyMember(
      memberId,
      'BIENVENUE',
      'Bienvenue chez Jeunes MIMS !',
      `${member.firstName}, ta communauté t'attendait ! Découvre ton espace personnel, la vie du groupe et bien plus encore.`,
    );
    return this.prisma.onboarding.update({
      where: { memberId },
      data: { status: 'BIENVENUE_ENVOYEE', welcomeSentAt: new Date() },
    });
  }

  async sendRegulation(memberId: string, regulationDocumentId: string) {
    await this.notifications.notifyMember(
      memberId,
      'AUTRE',
      'Le règlement intérieur t\'attend',
      'Prends un instant pour lire le règlement intérieur de Jeunes MIMS, disponible dans l\'espace Documents.',
    );
    return this.prisma.onboarding.update({
      where: { memberId },
      data: { status: 'TERMINE', regulationDocumentId, regulationSentAt: new Date() },
    });
  }
}
