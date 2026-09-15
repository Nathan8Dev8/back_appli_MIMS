import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode, RsvpResponse } from '@prisma/client';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list() {
    return this.events.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @Post()
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.events.create(dto, user.memberId);
  }

  @Post(':id/participation')
  respond(@Param('id') id: string, @Body('response') response: RsvpResponse, @CurrentUser() user: AuthenticatedUser) {
    return this.events.respond(id, user.memberId, response);
  }
}
