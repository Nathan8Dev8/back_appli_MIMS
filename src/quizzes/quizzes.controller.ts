import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { QuizzesService } from './quizzes.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  list() {
    return this.quizzes.list();
  }

  @Post()
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR)
  create(@Body() dto: CreateQuizDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.create(dto, user.memberId);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Body('answers') answers: Record<string, number>, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.submit(id, user.memberId, answers);
  }

  @Get(':id/me')
  myAttempt(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.myAttempt(id, user.memberId);
  }
}
