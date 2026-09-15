import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../database/prisma.service';
import { ChannelAdapter, ChannelSendResult } from './channel-adapter.interface';

/**
 * Notifications Web Push réelles, envoyées au système d'exploitation de
 * l'appareil du membre — elles apparaissent même si l'application n'est pas
 * ouverte (cf. demande : « même s'il n'est pas dans l'appli »).
 *
 * Nécessite VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT en
 * variables d'environnement (voir README). Sans ces clés, l'adaptateur se
 * dégrade proprement (aucun envoi, notification tout de même conservée en
 * base pour l'espace personnel).
 */
@Injectable()
export class WebPushChannelAdapter implements ChannelAdapter {
  private readonly logger = new Logger(WebPushChannelAdapter.name);
  private readonly configured: boolean;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:contact@jeunes-mims.org';

    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, publicKey!, privateKey!);
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absents : les notifications push réelles sont désactivées (voir README).',
      );
    }
  }

  async send(
    to: { phone?: string | null; email?: string | null; memberId: string },
    title: string,
    content: string,
  ): Promise<ChannelSendResult> {
    if (!this.configured) {
      return { success: false, error: 'push-not-configured' };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { memberId: to.memberId } });
    if (subscriptions.length === 0) {
      return { success: false, error: 'no-subscription' };
    }

    const payload = JSON.stringify({
      title,
      body: content,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      url: '/notifications',
    });

    let delivered = 0;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
        delivered += 1;
      } catch (err: any) {
        // 404/410 = l'abonnement n'est plus valide côté navigateur (désinstallation,
        // effacement des données…) : on le retire pour ne plus tenter de lui écrire.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        } else {
          this.logger.warn(`Échec d'envoi push (${err?.statusCode ?? 'erreur inconnue'}) pour ${to.memberId}`);
        }
      }
    }

    return delivered > 0
      ? { success: true, providerMessageId: `webpush-${delivered}-device(s)` }
      : { success: false, error: 'send-failed' };
  }
}
