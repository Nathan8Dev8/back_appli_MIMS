import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FeedbackKind, FeedbackStatus, RoleCode } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  NOUVEAU: 'reçu',
  PRIS_EN_COMPTE: 'pris en compte',
  TERMINE: 'terminé',
  NON_RETENU: 'pas retenu',
};

/** Bugs et idées d'amélioration de l'appli, envoyés au Président / Administrateur. */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    dto: { kind: FeedbackKind; title: string; description: string; page?: string; device?: string },
    file: Express.Multer.File | undefined,
    authorId: string,
  ) {
    const title = dto.title?.trim();
    const description = dto.description?.trim();
    if (!title || !description) throw new BadRequestException('Donne un titre et décris le problème ou l’idée.');
    if (!Object.values(FeedbackKind).includes(dto.kind)) throw new BadRequestException('Type invalide.');
    if (file && !file.mimetype.startsWith('image/')) throw new BadRequestException("La capture d'écran doit être une image.");

    const shot = file ? await this.storage.put(`feedback/${randomUUID()}-${file.originalname}`, file.buffer, file.mimetype) : null;
    const feedback = await this.prisma.appFeedback.create({
      data: {
        kind: dto.kind,
        title,
        description,
        page: dto.page?.slice(0, 300) || null,
        device: dto.device?.slice(0, 500) || null,
        screenshotKey: shot?.storageKey,
        screenshotName: file?.originalname,
        authorId,
      },
      include: { author: { select: { firstName: true, lastName: true } } },
    });

    const admins = await this.prisma.member.findMany({
      where: { id: { not: authorId }, status: 'ACTIF', roles: { some: { actif: true, role: { code: RoleCode.PRESIDENT_ADMIN } } } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        this.notifications.notifyMember(
          a.id,
          'AUTRE',
          `${dto.kind === 'BUG' ? '🐞 Bug signalé' : '✨ Idée d’amélioration'} : ${title}`,
          `${feedback.author.firstName} ${feedback.author.lastName}${feedback.page ? ` · page ${feedback.page}` : ''}`,
          '/administration?tab=retours',
        ),
      ),
    );
    return feedback;
  }

  mine(authorId: string) {
    return this.prisma.appFeedback.findMany({ where: { authorId }, orderBy: { createdAt: 'desc' } });
  }

  all() {
    return this.prisma.appFeedback.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
  }

  async update(id: string, dto: { status?: FeedbackStatus; adminNote?: string }) {
    const before = await this.prisma.appFeedback.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Retour introuvable.');
    if (dto.status && !Object.values(FeedbackStatus).includes(dto.status)) throw new BadRequestException('Statut invalide.');
    const feedback = await this.prisma.appFeedback.update({
      where: { id },
      data: { status: dto.status, adminNote: dto.adminNote === undefined ? undefined : dto.adminNote.trim() || null },
    });
    const icon = feedback.kind === 'BUG' ? '🐞' : '✨';
    if (dto.status && dto.status !== before.status) {
      await this.notifications.notifyMember(
        feedback.authorId,
        'AUTRE',
        `${icon} Ton signalement est ${STATUS_LABEL[dto.status]}`,
        feedback.adminNote ?? feedback.title,
        '/mon-profil',
      );
    } else if (feedback.adminNote && feedback.adminNote !== before.adminNote) {
      // Réponse envoyée (ou corrigée) sans changer le statut : la personne est prévenue aussi.
      await this.notifications.notifyMember(feedback.authorId, 'AUTRE', `${icon} Réponse à ton signalement`, feedback.adminNote, '/mon-profil');
    }
    return feedback;
  }

  async screenshot(id: string, memberId: string, isAdmin: boolean) {
    const feedback = await this.prisma.appFeedback.findUnique({ where: { id } });
    if (!feedback?.screenshotKey || (!isAdmin && feedback.authorId !== memberId)) throw new NotFoundException('Capture introuvable.');
    return { buffer: await this.storage.get(feedback.screenshotKey), name: feedback.screenshotName ?? 'capture.png' };
  }
}
