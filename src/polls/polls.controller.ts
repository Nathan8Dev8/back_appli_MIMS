import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { PollsService } from './polls.service';
import { CreatePollDto } from './dto/create-poll.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('polls')
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list() {
    return this.polls.list();
  }

  @Get(':id/results')
  results(@Param('id') id: string) {
    return this.polls.results(id);
  }

  @Post()
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR)
  create(@Body() dto: CreatePollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.polls.create(dto, user.memberId);
  }

  @Post(':id/votes')
  vote(@Param('id') id: string, @Body('optionId') optionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.polls.vote(id, optionId, user.memberId);
  }

  @Post(':id/close')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.polls.close(id, user.memberId);
  }
}
