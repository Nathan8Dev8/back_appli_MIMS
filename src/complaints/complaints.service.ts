import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { ComplaintCategory, ComplaintKind, ComplaintStatus, Prisma, RoleCode } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Qui traite quoi : le Pasteur voit tout ; le Président tout sauf la catégorie BUREAU
 * (qui peut viser un membre du bureau, y compris lui).
 */
export function handlerRolesFor(category: ComplaintCategory): RoleCode[] {
  return category === 'BUREAU' ? [RoleCode.PASTEUR_ENCADREUR] : [RoleCode.PASTEUR_ENCADREUR, RoleCode.PRESIDENT_ADMIN];
}
const canHandle = (roles: string[], category: ComplaintCategory) => handlerRolesFor(category).some((r) => roles.includes(r));
export const isHandler = (roles: string[]) => roles.includes(RoleCode.PASTEUR_ENCADREUR) || roles.includes(RoleCode.PRESIDENT_ADMIN);

const CLOSED: ComplaintStatus[] = ['RESOLUE', 'CLASSEE'];
const PERSON = { select: { id: true, firstName: true, lastName: true, avatarUrl: true, roles: { where: { actif: true }, select: { role: { select: { code: true } } } } } };
const KIND_LABEL: Record<ComplaintKind, string> = { PLAINTE: 'Plainte', SUGGESTION: 'Suggestion' };
const STATUS_LABEL: Record<ComplaintStatus, string> = { RECUE: 'reçue', EN_COURS: 'en cours de traitement', RESOLUE: 'résolue', CLASSEE: 'classée' };
const WEEK_MS = 7 * 24 * 3600 * 1000;

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Ce que la personne peut voir : ses propres envois + ceux qu'elle traite. */
  private visibleTo(user: AuthenticatedUser): Prisma.ComplaintWhereInput {
    if (user.roles.includes(RoleCode.PASTEUR_ENCADREUR)) return {}; // tout
    if (user.roles.includes(RoleCode.PRESIDENT_ADMIN)) return { OR: [{ authorId: user.memberId }, { category: { not: 'BUREAU' } }] };
    return { authorId: user.memberId };
  }

  private async load(id: string, user: AuthenticatedUser) {
    const complaint = await this.prisma.complaint.findUnique({ where: { id } });
    if (!complaint || (complaint.authorId !== user.memberId && !canHandle(user.roles, complaint.category))) {
      throw new NotFoundException('Plainte introuvable.');
    }
    return complaint;
  }

  list(user: AuthenticatedUser) {
    return this.prisma.complaint.findMany({
      where: this.visibleTo(user),
      orderBy: { updatedAt: 'desc' },
      include: { author: PERSON, _count: { select: { messages: true } } },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    await this.load(id, user);
    const complaint = await this.prisma.complaint.findUniqueOrThrow({
      where: { id },
      include: { author: PERSON, messages: { orderBy: { createdAt: 'asc' }, include: { author: PERSON } } },
    });
    return { ...complaint, canHandle: canHandle(user.roles, complaint.category) };
  }

  async create(
    dto: { kind: ComplaintKind; category: ComplaintCategory; subject: string; description: string },
    file: Express.Multer.File | undefined,
    user: AuthenticatedUser,
  ) {
    const subject = dto.subject?.trim();
    const description = dto.description?.trim();
    if (!subject || !description) throw new BadRequestException('Indique un sujet et décris la situation.');
    if (!Object.values(ComplaintKind).includes(dto.kind) || !Object.values(ComplaintCategory).includes(dto.category)) {
      throw new BadRequestException('Type ou catégorie invalide.');
    }

    const year = new Date().getFullYear();
    const count = await this.prisma.complaint.count({ where: { reference: { startsWith: `PL-${year}-` } } });
    const reference = `PL-${year}-${String(count + 1).padStart(4, '0')}`;
    const attachment = file ? await this.storage.put(`complaints/${reference}/${randomUUID()}-${file.originalname}`, file.buffer, file.mimetype) : null;

    const complaint = await this.prisma.complaint.create({
      data: {
        reference,
        kind: dto.kind,
        category: dto.category,
        subject,
        description,
        authorId: user.memberId,
        attachmentKey: attachment?.storageKey,
        attachmentName: file?.originalname,
      },
      include: { author: PERSON },
    });
    await this.audit.log({ actorId: user.memberId, action: 'CREATE_COMPLAINT', entityType: 'Complaint', entityId: complaint.id, after: { reference, kind: dto.kind, category: dto.category } });
    await this.notifyHandlers(
      complaint.category,
      user.memberId,
      `${dto.kind === 'PLAINTE' ? '📮 Nouvelle plainte' : '💡 Nouvelle suggestion'} : ${subject}`,
      `${complaint.author.firstName} ${complaint.author.lastName} · ${reference}`,
      `/plaintes/${complaint.id}`,
    );
    return complaint;
  }

  /** Message dans le fil. Un responsable qui répond à une plainte « reçue » la passe « en cours ». */
  async addMessage(id: string, content: string, user: AuthenticatedUser) {
    const complaint = await this.load(id, user);
    const text = content?.trim();
    if (!text) throw new BadRequestException('Écris un message.');
    if (CLOSED.includes(complaint.status)) throw new BadRequestException('Cette plainte est close : dépose-en une nouvelle si besoin.');

    const fromHandler = complaint.authorId !== user.memberId;
    const takesCharge = fromHandler && complaint.status === 'RECUE';
    await this.prisma.$transaction([
      this.prisma.complaintMessage.create({ data: { complaintId: id, authorId: user.memberId, content: text, newStatus: takesCharge ? 'EN_COURS' : null } }),
      this.prisma.complaint.update({ where: { id }, data: { status: takesCharge ? 'EN_COURS' : undefined, updatedAt: new Date() } }),
    ]);

    const url = `/plaintes/${id}`;
    if (fromHandler) {
      await this.notifications.notifyMember(complaint.authorId, 'AUTRE', `💬 Réponse à ta ${KIND_LABEL[complaint.kind].toLowerCase()}`, complaint.subject, url);
    } else {
      await this.notifyHandlers(complaint.category, user.memberId, `💬 Nouveau message · ${complaint.reference}`, complaint.subject, url);
    }
    return this.findOne(id, user);
  }

  /** Changement de statut par un responsable ; classer sans suite demande une explication. */
  async setStatus(id: string, status: ComplaintStatus, comment: string | undefined, user: AuthenticatedUser) {
    const complaint = await this.load(id, user);
    if (!canHandle(user.roles, complaint.category)) throw new ForbiddenException("Tu ne traites pas cette catégorie.");
    if (!Object.values(ComplaintStatus).includes(status) || status === 'RECUE') throw new BadRequestException('Statut invalide.');
    const text = comment?.trim() || null;
    if (status === 'CLASSEE' && !text) throw new BadRequestException('Explique pourquoi la plainte est classée.');

    await this.prisma.$transaction([
      this.prisma.complaintMessage.create({ data: { complaintId: id, authorId: user.memberId, content: text, newStatus: status } }),
      this.prisma.complaint.update({ where: { id }, data: { status, closedAt: CLOSED.includes(status) ? new Date() : null } }),
    ]);
    await this.audit.log({ actorId: user.memberId, action: 'COMPLAINT_STATUS', entityType: 'Complaint', entityId: id, before: { status: complaint.status }, after: { status } });
    await this.notifications.notifyMember(
      complaint.authorId,
      'AUTRE',
      `📮 Ta ${KIND_LABEL[complaint.kind].toLowerCase()} est ${STATUS_LABEL[status]}`,
      text ?? complaint.subject,
      `/plaintes/${id}`,
    );
    return this.findOne(id, user);
  }

  async attachment(id: string, user: AuthenticatedUser) {
    const complaint = await this.load(id, user);
    if (!complaint.attachmentKey) throw new NotFoundException('Aucune pièce jointe.');
    return { buffer: await this.storage.get(complaint.attachmentKey), name: complaint.attachmentName ?? 'piece-jointe' };
  }

  private async notifyHandlers(category: ComplaintCategory, exceptMemberId: string, title: string, content: string, url: string) {
    const handlers = await this.prisma.member.findMany({
      where: { id: { not: exceptMemberId }, status: 'ACTIF', roles: { some: { actif: true, role: { code: { in: handlerRolesFor(category) } } } } },
      select: { id: true },
    });
    await Promise.all(handlers.map((h) => this.notifications.notifyMember(h.id, 'AUTRE', title, content, url)));
  }

  /** Chaque matin : une plainte restée « reçue » (sans réponse) depuis 7 jours est rappelée aux responsables, une fois par semaine. */
  @Cron('0 9 * * *', { timeZone: 'Africa/Douala' })
  async unansweredReminder() {
    const weekAgo = new Date(Date.now() - WEEK_MS);
    const waiting = await this.prisma.complaint.findMany({
      where: { status: 'RECUE', createdAt: { lte: weekAgo }, OR: [{ remindedAt: null }, { remindedAt: { lte: weekAgo } }] },
    });
    for (const c of waiting) {
      await this.notifyHandlers(c.category, c.authorId, `⏰ Sans réponse depuis 7 jours · ${c.reference}`, c.subject, `/plaintes/${c.id}`);
      await this.prisma.complaint.update({ where: { id: c.id }, data: { remindedAt: new Date() } });
    }
    if (waiting.length) this.logger.log(`Rappel plaintes sans réponse : ${waiting.length}.`);
  }
}
