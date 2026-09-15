import { Injectable } from '@nestjs/common';
import { RsvpResponse } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list() {
    return this.prisma.event.findMany({
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { participations: true } } },
    });
  }

  async findOne(id: string) {
    return this.prisma.event.findUniqueOrThrow({
      where: { id },
      include: { participations: { include: { member: true } } },
    });
  }

  async create(dto: CreateEventDto, actorId: string) {
    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        location: dto.location,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        createdById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'CREATE_EVENT', entityType: 'Event', entityId: event.id, after: event });

    const members = await this.prisma.member.findMany({ where: { status: 'ACTIF' } });
    await Promise.all(
      members.map((m) =>
        this.notifications.notifyMember(
          m.id,
          'EVENEMENT',
          `Nouvel événement : ${event.title}`,
          `Rejoins-nous le ${event.startsAt.toLocaleDateString('fr-FR')} ! Confirme ta présence dans l'espace Événements.`,
        ),
      ),
    );

    return event;
  }

  async respond(eventId: string, memberId: string, response: RsvpResponse) {
    const participation = await this.prisma.eventParticipation.upsert({
      where: { eventId_memberId: { eventId, memberId } },
      update: { response, respondedAt: new Date() },
      create: { eventId, memberId, response, respondedAt: new Date() },
    });
    await this.audit.log({
      actorId: memberId,
      action: 'RSVP_EVENT',
      entityType: 'Event',
      entityId: eventId,
      after: { response },
    });
    return participation;
  }
}
