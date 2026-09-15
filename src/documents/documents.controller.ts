import {
  Body,
  Controller,
  Get,
  Param,
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
  list(@Query('type') type: DocumentType | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.list(type, canSeeDrafts(user));
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

  @Get(':id/download')
  async download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, document } = await this.documents.getForDownload(id, canSeeDrafts(user));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${document.documentCode}"`);
    res.send(buffer);
  }
}

const DOCUMENT_MANAGER_ROLES: RoleCode[] = [RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN];

function canSeeDrafts(user: AuthenticatedUser) {
  return user.roles.some((r) => DOCUMENT_MANAGER_ROLES.includes(r as RoleCode));
}
