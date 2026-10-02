import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Quiz, RoleCode } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DEFAULT_DURATION_MS,
  QuizAnswer,
  grade,
  monthRange,
  perfectScorers,
  previousMonth,
  publicQuestions,
  readQuestions,
  startOfWeek,
  validateQuestions,
} from './quiz-rules';

/** Ceux qui préparent les quiz et reçoivent les rappels. */
export const QUIZ_MANAGERS: RoleCode[] = [RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR];

const TIME_ZONE = 'Africa/Douala';
const MEMBER_NAME = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } };

const isClosed = (q: Pick<Quiz, 'status' | 'closesAt'>) => q.status === 'CLOTURE' || (!!q.closesAt && q.closesAt <= new Date());

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger(QuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Tous les quiz, du plus récent au plus ancien, avec le résultat du membre connecté. */
  async list(memberId: string, isManager: boolean) {
    const quizzes = await this.prisma.quiz.findMany({
      where: { status: { not: 'BROUILLON' } },
      orderBy: { publishedAt: 'desc' },
      include: {
        attempts: { where: { memberId }, select: { score: true, total: true, submittedAt: true } },
        _count: { select: { attempts: true } },
      },
    });
    return quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      comment: q.comment,
      publishedAt: q.publishedAt,
      closesAt: q.closesAt,
      closed: isClosed(q),
      questionCount: readQuestions(q.content).length,
      myAttempt: q.attempts[0] ?? null,
      participants: isManager ? q._count.attempts : undefined,
    }));
  }

  /** Un quiz : questions (bonnes réponses visibles seulement une fois clos, ou pour un responsable) et ma participation. */
  async findOne(id: string, memberId: string, isManager: boolean) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id } });
    if (!quiz || quiz.status === 'BROUILLON') throw new NotFoundException('Quiz introuvable.');
    const closed = isClosed(quiz);
    const attempt = await this.prisma.quizAttempt.findUnique({ where: { quizId_memberId: { quizId: id, memberId } } });
    return {
      id: quiz.id,
      title: quiz.title,
      comment: quiz.comment,
      publishedAt: quiz.publishedAt,
      closesAt: quiz.closesAt,
      closed,
      questions: publicQuestions(readQuestions(quiz.content), closed || isManager),
      // Pendant le quiz, le participant voit son score mais pas le détail juste/faux (les réponses circuleraient).
      myAttempt: attempt && {
        score: attempt.score,
        total: attempt.total,
        submittedAt: attempt.submittedAt,
        answers: attempt.answers,
        results: closed ? attempt.results : undefined,
      },
    };
  }

  async create(dto: { title: string; comment?: string; questions: unknown; closesAt?: string }, actorId: string) {
    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('Donne un titre au quiz.');
    const questions = validateQuestions(dto.questions);
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : new Date(Date.now() + DEFAULT_DURATION_MS);
    if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) throw new BadRequestException('La date de fin doit être dans le futur.');

    const quiz = await this.prisma.quiz.create({
      data: {
        title,
        comment: dto.comment?.trim() || null,
        content: { questions } as any,
        status: 'PUBLIE',
        publishedAt: new Date(),
        closesAt,
      },
    });
    await this.audit.log({ actorId, action: 'CREATE_QUIZ', entityType: 'Quiz', entityId: quiz.id, after: { title, questions: questions.length } });

    const members = await this.prisma.member.findMany({ where: { status: 'ACTIF' }, select: { id: true } });
    const until = closesAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE });
    await Promise.all(
      members.map((m) =>
        this.notifications.notifyMember(m.id, 'AUTRE', `🧠 Quiz de la semaine : ${title}`, `${questions.length} question(s), à faire jusqu'au ${until}.`, `/quiz/${quiz.id}`),
      ),
    );
    return quiz;
  }

  async submit(quizId: string, memberId: string, answers: Record<string, QuizAnswer>) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz || quiz.status === 'BROUILLON') throw new NotFoundException('Quiz introuvable.');
    if (isClosed(quiz)) throw new BadRequestException('Ce quiz est terminé.');
    const existing = await this.prisma.quizAttempt.findUnique({ where: { quizId_memberId: { quizId, memberId } } });
    if (existing) throw new ConflictException('Tu as déjà répondu à ce quiz.');

    const questions = readQuestions(quiz.content);
    const results = grade(questions, answers ?? {});
    const score = Object.values(results).filter(Boolean).length;
    const attempt = await this.prisma.quizAttempt.create({
      data: { quizId, memberId, answers: (answers ?? {}) as any, results, score, total: questions.length },
    });
    return { score: attempt.score, total: attempt.total };
  }

  /** Résultats de tous les participants, avec leurs réponses (responsables). */
  async results(quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { attempts: { include: { member: MEMBER_NAME }, orderBy: [{ score: 'desc' }, { submittedAt: 'asc' }] } },
    });
    if (!quiz) throw new NotFoundException('Quiz introuvable.');
    return {
      questions: readQuestions(quiz.content),
      attempts: quiz.attempts.map((a) => ({
        id: a.id,
        member: a.member,
        answers: a.answers,
        results: a.results,
        score: a.score,
        total: a.total,
        submittedAt: a.submittedAt,
      })),
    };
  }

  /** Un responsable corrige à la main une réponse (ex. réponse écrite juste mais formulée autrement). */
  async setResult(quizId: string, attemptId: string, questionId: string, correct: boolean, actorId: string) {
    const attempt = await this.prisma.quizAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.quizId !== quizId) throw new NotFoundException('Participation introuvable.');
    const results = { ...((attempt.results as Record<string, boolean>) ?? {}) };
    if (!(questionId in results)) throw new BadRequestException('Question inconnue.');
    results[questionId] = !!correct;
    const score = Object.values(results).filter(Boolean).length;
    await this.prisma.quizAttempt.update({ where: { id: attemptId }, data: { results, score } });
    await this.audit.log({
      actorId,
      action: 'QUIZ_CORRECTION',
      entityType: 'QuizAttempt',
      entityId: attemptId,
      before: { [questionId]: (attempt.results as any)?.[questionId], score: attempt.score },
      after: { [questionId]: !!correct, score },
    });
    return { score, total: attempt.total, results };
  }

  /** Sans-faute d'un mois (heure de Douala) : membres ayant eu la note maximale à tous les quiz du mois. */
  async rewards(year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const quizzes = await this.prisma.quiz.findMany({
      where: { status: { not: 'BROUILLON' }, publishedAt: { gte: from, lt: to } },
      select: { id: true },
    });
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { quizId: { in: quizzes.map((q) => q.id) } },
      select: { memberId: true, score: true, total: true },
    });
    const winners = perfectScorers(quizzes.length, attempts);
    const members = await this.prisma.member.findMany({ where: { id: { in: winners.map((w) => w.memberId) } }, ...MEMBER_NAME });
    const byId = new Map(members.map((m) => [m.id, m]));
    return {
      year,
      month,
      quizCount: quizzes.length,
      winners: winners.map((w) => ({ ...w, member: byId.get(w.memberId) })).filter((w) => w.member),
    };
  }

  // ——— Rappels automatiques aux responsables ———

  private async notifyManagers(title: string, content: string, url: string) {
    const managers = await this.prisma.member.findMany({
      where: { status: 'ACTIF', roles: { some: { actif: true, role: { code: { in: QUIZ_MANAGERS } } } } },
      select: { id: true },
    });
    await Promise.all(managers.map((m) => this.notifications.notifyMember(m.id, 'AUTRE', title, content, url)));
    return managers.length;
  }

  /** Lundi et jeudi à 9 h : s'il n'y a pas encore de quiz cette semaine, on le rappelle aux responsables. */
  @Cron('0 9 * * 1,4', { timeZone: TIME_ZONE })
  async weeklyQuizReminder() {
    const thisWeek = await this.prisma.quiz.count({ where: { status: { not: 'BROUILLON' }, publishedAt: { gte: startOfWeek() } } });
    if (thisWeek) return;
    const sent = await this.notifyManagers(
      '🧠 Pas encore de quiz cette semaine',
      "Le quiz est hebdomadaire : pense à préparer celui de cette semaine pour les jeunes.",
      '/quiz',
    );
    this.logger.log(`Rappel quiz hebdomadaire envoyé à ${sent} responsable(s).`);
  }

  /** Le 1er du mois à 9 h : liste des sans-faute du mois écoulé, à récompenser. */
  @Cron('0 9 1 * *', { timeZone: TIME_ZONE })
  async monthlyRewardReminder() {
    const { year, month } = previousMonth();
    const { winners, quizCount } = await this.rewards(year, month);
    if (!winners.length) return;
    const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const names = winners.map((w) => `${w.member!.firstName} ${w.member!.lastName} (${w.score}/${w.total})`).join(', ');
    await this.notifyManagers(
      `🏆 Récompense à prévoir : ${winners.length} sans-faute en ${label}`,
      `Sans-faute aux ${quizCount} quiz de ${label} : ${names}. Pense à leur remettre une récompense !`,
      '/quiz',
    );
    this.logger.log(`Rappel de récompense : ${winners.length} sans-faute en ${label}.`);
  }
}
