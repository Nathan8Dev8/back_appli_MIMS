import { Body, Controller, Get, Param, Patch, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RoleCode, RsvpResponse } from '@prisma/client';
import { EventsService } from './events.service';
import { AttendanceDto, CreateEventDto, UpdateEventDto } from './dto/create-event.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

const ORGANIZERS = [RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list() {
    return this.events.list();
  }

  @Get('attendance/:memberId')
  @Roles(...ORGANIZERS, RoleCode.TRESORIER)
  memberAttendance(@Param('memberId') memberId: string) {
    return this.events.memberAttendance(memberId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @Post()
  @Roles(...ORGANIZERS)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.events.create(dto, user.memberId);
  }

  @Patch(':id')
  @Roles(...ORGANIZERS)
  update(@Param('id') id: string, @Body() dto: UpdateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.events.update(id, dto, user.memberId);
  }

  @Post('series/:seriesId/stop')
  @Roles(...ORGANIZERS)
  stopSeries(@Param('seriesId') seriesId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.events.stopSeries(seriesId, user.memberId);
  }

  @Post(':id/cancel')
  @Roles(...ORGANIZERS)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.events.cancel(id, user.memberId);
  }

  @Put(':id/attendance')
  @Roles(...ORGANIZERS)
  setAttendance(@Param('id') id: string, @Body() dto: AttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.events.setAttendance(id, dto.presentMemberIds, user.memberId);
  }

  // Même droit que pour publier un document : le PV part directement dans Documents.
  @Post(':id/report')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  attachReport(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthenticatedUser) {
    return this.events.attachReport(id, file, user.memberId);
  }

  @Post(':id/participation')
  respond(@Param('id') id: string, @Body('response') response: RsvpResponse, @CurrentUser() user: AuthenticatedUser) {
    return this.events.respond(id, user.memberId, response);
  }
}
