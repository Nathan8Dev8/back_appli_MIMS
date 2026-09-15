import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list() {
    return this.roles.list();
  }

  @Post(':memberId/assign')
  @Roles(RoleCode.PRESIDENT_ADMIN)
  assign(@Param('memberId') memberId: string, @Body('role') role: RoleCode, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.assign(memberId, role, user.memberId);
  }

  @Post(':memberId/revoke')
  @Roles(RoleCode.PRESIDENT_ADMIN)
  revoke(@Param('memberId') memberId: string, @Body('role') role: RoleCode, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.revoke(memberId, role, user.memberId);
  }
}
