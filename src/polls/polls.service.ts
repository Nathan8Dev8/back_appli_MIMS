import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePollDto } from './dto/create-poll.dto';

@Injectable()
export class PollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list() {
    return this.prisma.poll.findMany({
      orderBy: { createdAt: 'desc' },
      include: { options: { include: { _count: { select: { votes: true } } } } },
    });
  }

  async create(dto: CreatePollDto, actorId: string) {
    const poll = await this.prisma.poll.create({
      data: {
        title: dto.title,
        description: dto.description,
        anonymous: dto.anonymous ?? false,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
        options: { create: dto.options.map((label) => ({ label })) },
      },
      include: { options: true },
    });

    await this.audit.log({ actorId, action: 'CREATE_POLL', entityType: 'Poll', entityId: poll.id, after: poll });

    const members = await this.prisma.member.findMany({ where: { status: 'ACTIF' } });
    await Promise.all(
      members.map((m) =>
        this.notifications.notifyMember(
          m.id,
          'SONDAGE',
          `Nouveau sondage : ${poll.title}`,
          "Le bureau aimerait ton avis. Tu peux voter dans l'onglet Sondages.",
          '/sondages',
        ),
      ),
    );

    return poll;
  }

  async vote(pollId: string, optionId: string, memberId: string) {
    const poll = await this.prisma.poll.findUniqueOrThrow({ where: { id: pollId } });
    if (poll.status === 'CLOTURE' || (poll.closesAt && poll.closesAt < new Date())) {
      throw new BadRequestException('Ce sondage est clôturé.');
    }
    const existing = await this.prisma.vote.findUnique({
      where: { pollId_memberId: { pollId, memberId } },
    });
    if (existing) throw new ConflictException('Tu as déjà voté pour ce sondage.');

    return this.prisma.vote.create({ data: { pollId, optionId, memberId } });
  }

  async close(pollId: string, actorId: string) {
    const poll = await this.prisma.poll.update({ where: { id: pollId }, data: { status: 'CLOTURE' } });
    await this.audit.log({ actorId, action: 'CLOSE_POLL', entityType: 'Poll', entityId: pollId, after: { status: 'CLOTURE' } });
    return poll;
  }
}
