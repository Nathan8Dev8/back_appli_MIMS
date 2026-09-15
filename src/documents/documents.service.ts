import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Les membres ne voient que les documents publiés ; seuls les responsables
   * habilités à publier (secrétaire, président/admin) voient aussi les
   * brouillons, le temps de les finaliser.
   */
  async list(type?: DocumentType, includeDrafts = false) {
    return this.prisma.document.findMany({
      where: {
        AND: [type ? { type } : {}, includeDrafts ? { status: { not: 'ARCHIVE' } } : { status: 'PUBLIE' }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upload(
    file: Express.Multer.File,
    meta: { type: DocumentType; title: string; description?: string; documentDate?: string },
    actorId: string,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    const count = await this.prisma.document.count();
    const documentCode = `DOC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    const key = `documents/${documentCode}/${randomUUID()}-${file.originalname}`;
    const { storageKey, sha256 } = await this.storage.put(key, file.buffer, file.mimetype);

    const document = await this.prisma.document.create({
      data: {
        documentCode,
        type: meta.type,
        title: meta.title,
        description: meta.description,
        documentDate: meta.documentDate ? new Date(meta.documentDate) : undefined,
        storageKey,
        sha256,
        status: 'BROUILLON',
      },
    });

    await this.audit.log({
      actorId,
      action: 'UPLOAD_DOCUMENT',
      entityType: 'Document',
      entityId: document.id,
      after: document,
    });

    return document;
  }

  async publish(id: string, actorId: string) {
    const document = await this.prisma.document.update({
      where: { id },
      data: { status: 'PUBLIE', publishedAt: new Date(), publishedById: actorId },
    });

    await this.audit.log({
      actorId,
      action: 'PUBLISH_DOCUMENT',
      entityType: 'Document',
      entityId: id,
      after: { status: 'PUBLIE' },
    });

    const members = await this.prisma.member.findMany({ where: { status: 'ACTIF' } });
    const label = document.type === 'PV' ? 'Un nouveau procès-verbal' : 'Un nouveau document';
    await Promise.all(
      members.map((m) =>
        this.notifications.notifyMember(
          m.id,
          'DOCUMENT_PUBLIE',
          'Nouveau document disponible',
          `${label} vient d'être publié : « ${document.title} ». Consultez-le dans l'espace Documents.`,
        ),
      ),
    );

    return document;
  }

  async getForDownload(id: string, canSeeDrafts: boolean) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document introuvable.');
    if (document.status !== 'PUBLIE' && !canSeeDrafts) {
      throw new NotFoundException('Document introuvable.');
    }
    const buffer = await this.storage.get(document.storageKey);
    return { document, buffer };
  }
}
