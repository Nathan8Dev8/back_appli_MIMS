import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RoleCode } from '@prisma/client';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @Roles(RoleCode.SECRETAIRE, RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR)
  list(@Query('search') search?: string, @Query('status') status?: string) {
    return this.members.list(search, status);
  }

  // Réservé au Président/Admin : la Secrétaire ne peut pas enregistrer de nouveaux membres.
  @Post()
  @Roles(RoleCode.PRESIDENT_ADMIN)
  create(@Body() dto: CreateMemberDto, @CurrentUser() user: AuthenticatedUser) {
    return this.members.create(dto, user.memberId);
  }

  // « Mon profil » — chaque membre gère ses propres informations.
  @Patch('me')
  updateOwnProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.members.updateProfile(user.memberId, dto);
  }

  // « Ma photo » — chaque membre peut changer sa photo de profil.
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', { storage: memoryStorage() }))
  updateOwnAvatar(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    return this.members.updateAvatar(user.memberId, file);
  }

  @Get(':id')
  @Roles(RoleCode.SECRETAIRE, RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN, RoleCode.PASTEUR_ENCADREUR)
  findOne(@Param('id') id: string) {
    return this.members.findOne(id);
  }

  @Patch(':id/status')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  setStatus(@Param('id') id: string, @Body('status') status: string, @CurrentUser() user: AuthenticatedUser) {
    return this.members.setStatus(id, status, user.memberId);
  }
}
