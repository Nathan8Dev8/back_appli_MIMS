import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { extname } from 'path';
import { DocumentType, RoleCode } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @Query('type') type: DocumentType | undefined,
    @Query('archived') archived: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.list(type, canSeeDrafts(user), archived === '1');
  }

  @Post()
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: DocumentType,
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('documentDate') documentDate: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.upload(file, { type, title, description, documentDate }, user.memberId);
  }

  @Post(':id/publish')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  publish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.publish(id, user.memberId);
  }

  @Patch(':id')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  update(
    @Param('id') id: string,
    @Body() body: { type?: DocumentType; title?: string; description?: string; documentDate?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (body.type && !Object.values(DocumentType).includes(body.type)) throw new BadRequestException('Type invalide.');
    return this.documents.update(id, body, user.memberId);
  }

  @Post(':id/archive')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.setArchived(id, true, user.memberId);
  }

  @Post(':id/restore')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  restore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.setArchived(id, false, user.memberId);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, document } = await this.documents.getForDownload(id, canSeeDrafts(user));
    res.setHeader('Content-Type', 'application/octet-stream');
    // On garde l'extension d'origine, sinon le fichier ne s'ouvre pas sur téléphone.
    res.setHeader('Content-Disposition', `attachment; filename="${document.documentCode}${extname(document.storageKey)}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  }
}

const DOCUMENT_MANAGER_ROLES: RoleCode[] = [RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN];

function canSeeDrafts(user: AuthenticatedUser) {
  return user.roles.some((r) => DOCUMENT_MANAGER_ROLES.includes(r as RoleCode));
}
