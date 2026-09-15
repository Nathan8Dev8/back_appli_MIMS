import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(memberId: string, dto: SubscribePushDto, userAgent?: string) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: { memberId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent },
      create: {
        memberId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent,
      },
    });
    return { success: true };
  }

  async unsubscribe(memberId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { memberId, endpoint } });
    return { success: true };
  }

  async listMyDevices(memberId: string) {
    return this.prisma.pushSubscription.findMany({
      where: { memberId },
      select: { id: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
