import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapter, ChannelSendResult } from './channel-adapter.interface';

/**
 * Adaptateur générique qui journalise l'envoi au lieu d'appeler un
 * fournisseur réel. Utilisé par défaut pour PUSH / WHATSAPP / SMS / EMAIL
 * tant que les fournisseurs (cahier des charges §13) ne sont pas choisis.
 *
 * Pour la production : implémenter un adaptateur par canal respectant
 * `ChannelAdapter` (Web Push + VAPID, WhatsApp Cloud API, Twilio/Orange SMS…)
 * et le brancher dans NotificationsModule — voir README « Mise en production ».
 */
@Injectable()
export class LogChannelAdapter implements ChannelAdapter {
  private readonly logger = new Logger(LogChannelAdapter.name);

  constructor(private readonly channelName: string) {}

  async send(
    to: { phone?: string | null; email?: string | null; memberId: string },
    title: string,
    content: string,
  ): Promise<ChannelSendResult> {
    this.logger.log(
      `[${this.channelName}] → membre ${to.memberId} (${to.phone ?? to.email ?? 'n/a'}) : "${title}" — ${content}`,
    );
    return { success: true, providerMessageId: `simulated-${Date.now()}` };
  }
}
