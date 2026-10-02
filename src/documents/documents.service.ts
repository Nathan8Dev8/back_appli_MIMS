import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DocumentStatus, DocumentType } from '@prisma/client';
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
   * brouillons, le temps de les finaliser. Les documents archivés ne sont plus
   * « en cours » mais restent consultables par tous dans l'Historique.
   */
  async list(type?: DocumentType, includeDrafts = false, includeArchived = false) {
    const statuses: DocumentStatus[] = ['PUBLIE'];
    if (includeDrafts) statuses.push('BROUILLON');
    if (includeArchived) statuses.push('ARCHIVE');
    return this.prisma.document.findMany({
      where: { ...(type ? { type } : {}), status: { in: statuses } },
      orderBy: [{ documentDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: { reportFor: { select: { id: true } } },
    });
  }

  async update(id: string, meta: { type?: DocumentType; title?: string; description?: string; documentDate?: string }, actorId: string) {
    const before = await this.prisma.document.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Document introuvable.');
    const document = await this.prisma.document.update({
      where: { id },
      data: {
        type: meta.type,
        title: meta.title?.trim() || undefined,
        description: meta.description === undefined ? undefined : meta.description.trim() || null,
        documentDate: meta.documentDate === undefined ? undefined : meta.documentDate ? new Date(meta.documentDate) : null,
      },
    });
    await this.audit.log({ actorId, action: 'UPDATE_DOCUMENT', entityType: 'Document', entityId: id, before, after: document });
    return document;
  }

  /** Archiver ne supprime rien : le document sort de la liste courante mais reste dans l'Historique. */
  async setArchived(id: string, archived: boolean, actorId: string) {
    const before = await this.prisma.document.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Document introuvable.');
    const status: DocumentStatus = archived ? 'ARCHIVE' : before.publishedAt ? 'PUBLIE' : 'BROUILLON';
    const document = await this.prisma.document.update({ where: { id }, data: { status } });
    await this.audit.log({ actorId, action: archived ? 'ARCHIVE_DOCUMENT' : 'RESTORE_DOCUMENT', entityType: 'Document', entityId: id, after: { status } });
    return document;
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
    const label = document.type === 'PV' ? 'Nouveau procès-verbal' : 'Nouveau document';
    await Promise.all(
      members.map((m) =>
        this.notifications.notifyMember(
          m.id,
          'DOCUMENT_PUBLIE',
          'Nouveau document',
          `${label} : « ${document.title} ». Tu peux le lire dans l'onglet Documents.`,
          document.type === 'PV' ? '/historique?type=documents' : '/documents',
        ),
      ),
    );

    return document;
  }

  async getForDownload(id: string, canSeeDrafts: boolean) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document introuvable.');
    if (document.status === 'BROUILLON' && !canSeeDrafts) {
      throw new NotFoundException('Document introuvable.');
    }
    const buffer = await this.storage.get(document.storageKey);
    return { document, buffer };
  }
}
