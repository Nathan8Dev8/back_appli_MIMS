import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list() {
    return this.prisma.announcement.findMany({
      orderBy: { publishedAt: 'desc' },
      include: { publishedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
  }

  /**
   * Publie immédiatement une annonce (pas de brouillon) et notifie tous les
   * membres actifs — cf. demande : « quand elle est publiée, tout le monde
   * reçoit une notification ».
   */
  async create(dto: CreateAnnouncementDto, file: Express.Multer.File | undefined, actorId: string) {
    let attachment: { attachmentKey: string; attachmentName: string; attachmentMime: string; attachmentSha256: string } | undefined;

    if (file) {
      const key = `announcements/${randomUUID()}-${file.originalname}`;
      const { url, sha256 } = await this.storage.put(key, file.buffer, file.mimetype);
      attachment = {
        // URL directement consommable par le front via `fileUrl()` — /files
        // en local, l'URL publique S3/CDN en production.
        attachmentKey: url,
        attachmentName: file.originalname,
        attachmentMime: file.mimetype,
        attachmentSha256: sha256,
      };
    }

    const announcement = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        publishedById: actorId,
        ...attachment,
      },
    });

    await this.audit.log({
      actorId,
      action: 'PUBLISH_ANNOUNCEMENT',
      entityType: 'Announcement',
      entityId: announcement.id,
      after: { title: announcement.title, hasAttachment: !!file },
    });

    const members = await this.prisma.member.findMany({ where: { status: 'ACTIF' } });
    await Promise.all(
      members.map((m) =>
        this.notifications.notifyMember(
          m.id,
          'ANNONCE',
          `Nouvelle annonce : ${announcement.title}`,
          announcement.content.length > 140 ? `${announcement.content.slice(0, 140)}…` : announcement.content,
        ),
      ),
    );

    return announcement;
  }
}
