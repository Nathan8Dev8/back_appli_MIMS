import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RsvpResponse } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';

const REPORT_DOCUMENT = { select: { id: true, title: true, documentCode: true, status: true } };

/** Un champ texte vidé dans le formulaire est enregistré comme absent. */
const clean = (value?: string) => (value === undefined ? undefined : value.trim() || null);

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Le groupe compte quelques dizaines de membres : on renvoie les réponses brutes, l'écran fait les comptes. */
  list() {
    return this.prisma.event.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        participations: { select: { memberId: true, response: true, attended: true } },
        reportDocument: REPORT_DOCUMENT,
      },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        participations: {
          include: { member: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, status: true } } },
        },
        reportDocument: REPORT_DOCUMENT,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!event) throw new NotFoundException('Événement introuvable.');
    return event;
  }

  async create(dto: CreateEventDto, actorId: string) {
    const event = await this.prisma.event.create({
      data: {
        kind: dto.kind,
        title: dto.title.trim(),
        description: clean(dto.description),
        location: clean(dto.location),
        agenda: clean(dto.agenda),
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        createdById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'CREATE_EVENT', entityType: 'Event', entityId: event.id, after: event });

    const label = event.kind === 'ASSISE' ? 'Nouvelle assise' : 'Nouvel événement';
    await this.notifyActiveMembers(
      `${label} : ${event.title}`,
      `C'est prévu le ${event.startsAt.toLocaleDateString('fr-FR')}. Touche ici pour dire si tu seras là.`,
      `/evenements/${event.id}`,
    );

    return event;
  }

  async update(id: string, dto: UpdateEventDto, actorId: string) {
    const before = await this.findOne(id);
    const event = await this.prisma.event.update({
      where: { id },
      data: {
        kind: dto.kind,
        title: dto.title?.trim() || undefined,
        description: clean(dto.description),
        location: clean(dto.location),
        agenda: clean(dto.agenda),
        decisions: clean(dto.decisions),
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      },
    });
    await this.audit.log({ actorId, action: 'UPDATE_EVENT', entityType: 'Event', entityId: id, before, after: event });
    return event;
  }

  async cancel(id: string, actorId: string) {
    const before = await this.findOne(id);
    if (before.status === 'ANNULE') throw new BadRequestException('Cet événement est déjà annulé.');
    const event = await this.prisma.event.update({ where: { id }, data: { status: 'ANNULE' } });
    await this.audit.log({ actorId, action: 'CANCEL_EVENT', entityType: 'Event', entityId: id, after: { status: 'ANNULE' } });
    await this.notifyActiveMembers(
      `Annulé : ${event.title}`,
      `« ${event.title} » prévu le ${event.startsAt.toLocaleDateString('fr-FR')} est annulé.`,
      `/evenements/${event.id}`,
    );
    return event;
  }

  async respond(eventId: string, memberId: string, response: RsvpResponse) {
    if (!Object.values(RsvpResponse).includes(response)) throw new BadRequestException('Réponse invalide.');
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    if (event.status === 'ANNULE') throw new BadRequestException('Cet événement est annulé.');
    if (event.startsAt < new Date()) throw new BadRequestException('Cet événement est déjà passé.');

    const participation = await this.prisma.eventParticipation.upsert({
      where: { eventId_memberId: { eventId, memberId } },
      update: { response, respondedAt: new Date() },
      create: { eventId, memberId, response, respondedAt: new Date() },
    });
    await this.audit.log({ actorId: memberId, action: 'RSVP_EVENT', entityType: 'Event', entityId: eventId, after: { response } });
    return participation;
  }

  /**
   * Pointage des présences réelles : tous les membres actifs (et ceux qui
   * avaient déjà répondu) sont marqués présents ou absents en une fois.
   */
  async setAttendance(eventId: string, presentMemberIds: string[], actorId: string) {
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { participations: true } });
    if (event.startsAt > new Date()) throw new BadRequestException("On pointe les présences une fois l'événement commencé.");

    const active = await this.prisma.member.findMany({ where: { status: 'ACTIF' }, select: { id: true } });
    const memberIds = new Set([...active.map((m) => m.id), ...event.participations.map((p) => p.memberId), ...presentMemberIds]);
    const present = new Set(presentMemberIds);

    await this.prisma.$transaction(
      [...memberIds].map((memberId) =>
        this.prisma.eventParticipation.upsert({
          where: { eventId_memberId: { eventId, memberId } },
          update: { attended: present.has(memberId) },
          create: { eventId, memberId, attended: present.has(memberId) },
        }),
      ),
    );
    await this.audit.log({ actorId, action: 'EVENT_ATTENDANCE', entityType: 'Event', entityId: eventId, after: { present: [...present] } });
    return this.findOne(eventId);
  }

  /** Rapport (assise) ou PV (autre événement) joint depuis la page de l'événement : publié et rangé dans Documents. */
  async attachReport(eventId: string, file: Express.Multer.File, actorId: string) {
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const assise = event.kind === 'ASSISE';
    await this.documents.upload(
      file,
      {
        type: assise ? 'ASSISE' : 'PV',
        title: `${assise ? "Rapport d'assise" : 'PV'} — ${event.title}`,
        documentDate: event.startsAt.toISOString(),
        eventId,
      },
      actorId,
    );
    return this.findOne(eventId);
  }

  /** Historique de présence d'un membre, pour sa fiche. */
  memberAttendance(memberId: string) {
    return this.prisma.eventParticipation.findMany({
      where: { memberId, attended: { not: null } },
      include: { event: { select: { id: true, title: true, kind: true, startsAt: true } } },
      orderBy: { event: { startsAt: 'desc' } },
    });
  }

  private async notifyActiveMembers(title: string, content: string, url: string) {
    const members = await this.prisma.member.findMany({ where: { status: 'ACTIF' }, select: { id: true } });
    await Promise.all(members.map((m) => this.notifications.notifyMember(m.id, 'EVENEMENT', title, content, url)));
  }
}
