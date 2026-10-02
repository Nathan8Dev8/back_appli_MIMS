import { Body, Controller, Get, Param, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { FeedbackKind, FeedbackStatus, RoleCode } from '@prisma/client';
import { FeedbackService } from './feedback.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @UseInterceptors(FileInterceptor('screenshot', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  create(
    @Body('kind') kind: FeedbackKind,
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('page') page: string,
    @Body('device') device: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.feedback.create({ kind, title, description, page, device }, file, user.memberId);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.feedback.mine(user.memberId);
  }

  @Get()
  @Roles(RoleCode.PRESIDENT_ADMIN)
  all() {
    return this.feedback.all();
  }

  @Patch(':id')
  @Roles(RoleCode.PRESIDENT_ADMIN)
  update(@Param('id') id: string, @Body('status') status: FeedbackStatus | undefined, @Body('adminNote') adminNote: string | undefined) {
    return this.feedback.update(id, { status, adminNote });
  }

  @Get(':id/screenshot')
  async screenshot(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, name } = await this.feedback.screenshot(id, user.memberId, user.roles.includes(RoleCode.PRESIDENT_ADMIN));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  }
}
