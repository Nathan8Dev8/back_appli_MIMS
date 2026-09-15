import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateQuizDto, QuizQuestionDto } from './dto/create-quiz.dto';

@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list() {
    const quizzes = await this.prisma.quiz.findMany({ orderBy: { createdAt: 'desc' } });
    // Ne jamais exposer les bonnes réponses tant que le quiz est ouvert.
    return quizzes.map((q) => ({
      ...q,
      content: {
        questions: (q.content as any).questions.map((question: QuizQuestionDto) => ({
          id: question.id,
          question: question.question,
          choices: question.choices,
        })),
      },
    }));
  }

  async create(dto: CreateQuizDto, actorId: string) {
    const quiz = await this.prisma.quiz.create({
      data: {
        title: dto.title,
        content: { questions: dto.questions } as any,
        status: 'PUBLIE',
        publishedAt: new Date(),
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
      },
    });
    await this.audit.log({ actorId, action: 'CREATE_QUIZ', entityType: 'Quiz', entityId: quiz.id, after: { title: dto.title } });
    return quiz;
  }

  async submit(quizId: string, memberId: string, answers: Record<string, number>) {
    const quiz = await this.prisma.quiz.findUniqueOrThrow({ where: { id: quizId } });
    if (quiz.status === 'CLOTURE') throw new BadRequestException('Ce quiz est clôturé.');

    const existing = await this.prisma.quizAttempt.findUnique({
      where: { quizId_memberId: { quizId, memberId } },
    });
    if (existing) throw new ConflictException('Vous avez déjà répondu à ce quiz.');

    const questions: QuizQuestionDto[] = (quiz.content as any).questions;
    let score = 0;
    for (const q of questions) {
      if (answers[q.id] === q.correctIndex) score += 1;
    }

    return this.prisma.quizAttempt.create({
      data: { quizId, memberId, answers: answers as any, score, total: questions.length },
    });
  }

  async myAttempt(quizId: string, memberId: string) {
    return this.prisma.quizAttempt.findUnique({ where: { quizId_memberId: { quizId, memberId } } });
  }
}
