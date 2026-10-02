import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { QUIZ_MANAGERS, QuizzesService } from './quizzes.service';
import { CreateQuizDto, SetResultDto } from './dto/create-quiz.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

const isManager = (user: AuthenticatedUser) => user.roles.some((r) => (QUIZ_MANAGERS as string[]).includes(r));

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.list(user.memberId, isManager(user));
  }

  /** Sans-faute d'un mois : ?month=AAAA-MM (par défaut le mois en cours). */
  @Get('rewards')
  @Roles(...QUIZ_MANAGERS)
  rewards(@Query('month') month?: string) {
    const now = new Date();
    const match = month?.match(/^(\d{4})-(\d{2})$/);
    if (month && !match) throw new BadRequestException('Mois invalide (AAAA-MM).');
    return this.quizzes.rewards(match ? Number(match[1]) : now.getFullYear(), match ? Number(match[2]) - 1 : now.getMonth());
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.findOne(id, user.memberId, isManager(user));
  }

  @Post()
  @Roles(...QUIZ_MANAGERS)
  create(@Body() dto: CreateQuizDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.create(dto, user.memberId);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Body('answers') answers: Record<string, number[] | string>, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.submit(id, user.memberId, answers);
  }

  @Get(':id/results')
  @Roles(...QUIZ_MANAGERS)
  results(@Param('id') id: string) {
    return this.quizzes.results(id);
  }

  @Patch(':id/attempts/:attemptId')
  @Roles(...QUIZ_MANAGERS)
  setResult(@Param('id') id: string, @Param('attemptId') attemptId: string, @Body() dto: SetResultDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.setResult(id, attemptId, dto.questionId, dto.correct, user.memberId);
  }
}
