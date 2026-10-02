import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';

/**
 * Le serveur enverra des requêtes à cette adresse : on n'accepte que les services push des
 * navigateurs (Chrome, Firefox, Safari, Edge), jamais une adresse arbitraire ou interne.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

function assertPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BadRequestException('Abonnement aux notifications invalide.');
  }
  const trusted = PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  if (url.protocol !== 'https:' || !trusted) throw new BadRequestException('Service de notifications non reconnu.');
}

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(memberId: string, dto: SubscribePushDto, userAgent?: string) {
    assertPushEndpoint(dto.endpoint);
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

}
