import { Body, Controller, Get, Param, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ComplaintCategory, ComplaintKind, ComplaintStatus } from '@prisma/client';
import { ComplaintsService } from './complaints.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Les droits fins (auteur / responsable de la catégorie) sont vérifiés dans le service. */
@UseGuards(JwtAuthGuard)
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.complaints.list(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaints.findOne(id, user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  create(
    @Body('kind') kind: ComplaintKind,
    @Body('category') category: ComplaintCategory,
    @Body('subject') subject: string,
    @Body('description') description: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.create({ kind, category, subject, description }, file, user);
  }

  @Post(':id/messages')
  addMessage(@Param('id') id: string, @Body('content') content: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaints.addMessage(id, content, user);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: ComplaintStatus,
    @Body('comment') comment: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.setStatus(id, status, comment, user);
  }

  @Get(':id/attachment')
  async attachment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, name } = await this.complaints.attachment(id, user);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  }
}
