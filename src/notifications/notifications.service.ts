import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, NotificationType, PreferredChannel } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { LogChannelAdapter } from './adapters/log-channel.adapter';
import { WebPushChannelAdapter } from './adapters/web-push-channel.adapter';
import { ChannelAdapter } from './adapters/channel-adapter.interface';

@Injectable()
export class NotificationsService {
  private readonly adapters: Record<NotificationChannel, ChannelAdapter>;

  constructor(private readonly prisma: PrismaService, webPushAdapter: WebPushChannelAdapter) {
    this.adapters = {
      PUSH: webPushAdapter,
      WHATSAPP: new LogChannelAdapter('WHATSAPP'),
      SMS: new LogChannelAdapter('SMS'),
      EMAIL: new LogChannelAdapter('EMAIL'),
    };
  }

  private resolveChannel(preferred: PreferredChannel, whatsappActive: boolean): NotificationChannel {
    if (preferred === 'WHATSAPP' && whatsappActive) return 'WHATSAPP';
    if (preferred === 'WHATSAPP' && !whatsappActive) return 'SMS';
    return preferred as unknown as NotificationChannel;
  }

  async notifyMember(memberId: string, type: NotificationType, title: string, content: string) {
    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    const channel = this.resolveChannel(member.preferredChannel, member.whatsappActive);

    const notification = await this.prisma.notification.create({
      data: { memberId, type, channel, title, content, status: 'EN_ATTENTE' },
    });

    const result = await this.adapters[channel].send(
      { phone: member.phone, email: member.email, memberId },
      title,
      content,
    );

    return this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: result.success ? NotificationStatus.ENVOYE : NotificationStatus.ECHEC,
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
}
