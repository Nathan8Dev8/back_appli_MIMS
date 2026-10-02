import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HORIZON_MS, Recurrence, describe, localTime, occurrences, validRecurrence } from './recurrence';
import { RsvpResponse } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';

const REPORT_DOCUMENT = { select: { id: true, title: true, documentCode: true, status: true } };
const SERIES = { select: { id: true, frequency: true, weekday: true, nth: true, monthDay: true, time: true, until: true, active: true } };

/** Latitude et longitude vont ensemble : les deux, ou aucune (null efface la position). */
function coordinates(dto: { latitude?: number | null; longitude?: number | null }) {
  if (dto.latitude === undefined && dto.longitude === undefined) return {};
  if (dto.latitude == null || dto.longitude == null) return { latitude: null, longitude: null };
  return { latitude: dto.latitude, longitude: dto.longitude };
}

/** Un champ texte vidé dans le formulaire est enregistré comme absent. */
const clean = (value?: string) => (value === undefined ? undefined : value.trim() || null);

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

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
        series: SERIES,
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
        series: SERIES,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!event) throw new NotFoundException('Événement introuvable.');
    return event;
  }

  async create(dto: CreateEventDto, actorId: string) {
    if (dto.repeat) return this.createSeries(dto, actorId);
    const event = await this.prisma.event.create({
      data: {
        kind: dto.kind,
        title: dto.title.trim(),
        description: clean(dto.description),
        location: clean(dto.location),
        ...coordinates(dto),
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

  // ——— Événements récurrents ———

  /** Crée la série puis ses premières dates ; une seule notification pour toute la série. */
  private async createSeries(dto: CreateEventDto, actorId: string) {
    const first = new Date(dto.startsAt);
    let rule;
    try {
      rule = validRecurrence(dto.repeat as Partial<Recurrence>, localTime(first));
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    const until = dto.repeat?.until ? new Date(dto.repeat.until) : null;
    if (until && (Number.isNaN(until.getTime()) || until < first)) throw new BadRequestException('La fin de la répétition doit être après la première date.');

    const series = await this.prisma.eventSeries.create({
      data: {
        kind: dto.kind,
        title: dto.title.trim(),
        description: clean(dto.description),
        location: clean(dto.location),
        ...coordinates(dto),
        agenda: clean(dto.agenda),
        frequency: rule!.frequency,
        weekday: rule!.weekday,
        nth: rule!.nth,
        monthDay: rule!.monthDay,
        time: rule!.time,
        until,
        createdById: actorId,
      },
    });
    await this.generateOccurrences(series.id, new Date(first.getTime() - 60_000));
    const firstEvent = await this.prisma.event.findFirst({ where: { seriesId: series.id }, orderBy: { startsAt: 'asc' } });
    if (!firstEvent) throw new BadRequestException("Aucune date ne correspond à cette répétition : vérifie la date de fin.");
    await this.audit.log({ actorId, action: 'CREATE_EVENT_SERIES', entityType: 'EventSeries', entityId: series.id, after: { title: series.title, rule: describe(rule!) } });

    await this.notifyActiveMembers(
      `🔁 Nouveau rendez-vous régulier : ${series.title}`,
      `${describe(rule!)[0].toUpperCase()}${describe(rule!).slice(1)}. Première fois le ${firstEvent.startsAt.toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })}.`,
      `/evenements/${firstEvent.id}`,
    );
    return firstEvent;
  }

  /** Crée les dates manquantes d'une série sur le mois à venir (au moins la prochaine). Sans notification. */
  async generateOccurrences(seriesId: string, from = new Date()) {
    const series = await this.prisma.eventSeries.findUniqueOrThrow({ where: { id: seriesId } });
    if (!series.active) return 0;
    const rule: Recurrence = { frequency: series.frequency, weekday: series.weekday, nth: series.nth, monthDay: series.monthDay, time: series.time };
    const limit = (d: Date) => (series.until && series.until < d ? series.until : d);
    let dates = occurrences(rule, from, limit(new Date(Date.now() + HORIZON_MS)));
    if (!dates.length) dates = occurrences(rule, from, limit(new Date(from.getTime() + 400 * 24 * 3600 * 1000))).slice(0, 1);

    const { count } = await this.prisma.event.createMany({
      data: dates.map((startsAt) => ({
        seriesId,
        kind: series.kind,
        title: series.title,
        description: series.description,
        location: series.location,
        latitude: series.latitude,
        longitude: series.longitude,
        agenda: series.agenda,
        startsAt,
        createdById: series.createdById,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /** Chaque nuit : les séries actives sont prolongées d'un mois. */
  @Cron('30 0 * * *', { timeZone: 'Africa/Douala' })
  async extendSeries() {
    const series = await this.prisma.eventSeries.findMany({ where: { active: true }, select: { id: true, until: true } });
    let created = 0;
    for (const s of series) {
      if (s.until && s.until < new Date()) {
        await this.prisma.eventSeries.update({ where: { id: s.id }, data: { active: false } });
        continue;
      }
      created += await this.generateOccurrences(s.id);
    }
    if (created) this.logger.log(`Événements récurrents : ${created} date(s) ajoutée(s).`);
  }

  /**
   * Arrête une série : plus de nouvelles dates. Les dates à venir sans aucune réponse sont retirées ;
   * celles où des membres ont déjà répondu sont annulées (ceux qui venaient sont prévenus). Le passé reste.
   */
  async stopSeries(seriesId: string, actorId: string) {
    const series = await this.prisma.eventSeries.findUnique({ where: { id: seriesId } });
    if (!series) throw new NotFoundException('Série introuvable.');
    await this.prisma.eventSeries.update({ where: { id: seriesId }, data: { active: false } });

    const upcoming = await this.prisma.event.findMany({
      where: { seriesId, startsAt: { gt: new Date() }, status: { not: 'ANNULE' } },
      include: { participations: { select: { memberId: true, response: true } } },
    });
    const empty = upcoming.filter((e) => !e.participations.length).map((e) => e.id);
    await this.prisma.event.deleteMany({ where: { id: { in: empty } } });
    for (const e of upcoming.filter((e) => e.participations.length)) {
      await this.prisma.event.update({ where: { id: e.id }, data: { status: 'ANNULE' } });
      const coming = e.participations.filter((p) => p.response === 'PRESENT');
      await Promise.all(
        coming.map((p) =>
          this.notifications.notifyMember(p.memberId, 'EVENEMENT', `Annulé : ${e.title}`, `« ${e.title} » du ${e.startsAt.toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })} n'aura pas lieu.`, `/evenements/${e.id}`),
        ),
      );
    }
    await this.audit.log({ actorId, action: 'STOP_EVENT_SERIES', entityType: 'EventSeries', entityId: seriesId, after: { removed: empty.length, cancelled: upcoming.length - empty.length } });
    return { removed: empty.length, cancelled: upcoming.length - empty.length };
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
        ...coordinates(dto),
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
