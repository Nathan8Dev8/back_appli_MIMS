import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { WebPushChannelAdapter } from './adapters/web-push-channel.adapter';

/**
 * Tout passe par l'appli : chaque notification est enregistrée (espace
 * personnel) puis poussée sur les appareils du membre via Web Push, ce qui
 * l'affiche même quand l'appli est fermée. WhatsApp / SMS / e-mail ne sont
 * pas utilisés pour l'instant.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly push: WebPushChannelAdapter) {}

  /** `url` = page ouverte quand on touche la notification. */
  async notifyMember(memberId: string, type: NotificationType, title: string, content: string, url = '/notifications') {
    const notification = await this.prisma.notification.create({
      data: { memberId, type, channel: 'PUSH', title, content, url, status: 'EN_ATTENTE' },
    });
    // Pastille sur l'icône de l'appli (comme une messagerie) : nombre de notifications non lues.
    const unread = await this.prisma.notification.count({ where: { memberId, status: { not: 'LU' } } });

    const result = await this.push.send(memberId, { id: notification.id, title, body: content, url, unread });

    return this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: result.success ? 'ENVOYE' : 'ECHEC',
        providerMessageId: result.providerMessageId,
        sentAt: result.success ? new Date() : null,
      },
    });
  }

  async listForMember(memberId: string) {
    return this.prisma.notification.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(memberId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, memberId },
      data: { status: 'LU', readAt: new Date() },
    });
  }

  async markAllRead(memberId: string) {
    return this.prisma.notification.updateMany({
      where: { memberId, status: { not: 'LU' } },
      data: { status: 'LU', readAt: new Date() },
    });
  }
}
