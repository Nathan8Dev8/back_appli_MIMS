import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { DuesService } from './dues.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dues')
export class DuesController {
  constructor(private readonly dues: DuesService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.dues.listForMember(user.memberId);
  }

  @Get()
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN, RoleCode.SECRETAIRE)
  all(@Query('status') status?: string) {
    return this.dues.listAll(status);
  }

  @Get('debt-summary')
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
  debtSummary() {
    return this.dues.debtSummary();
  }

  @Get('member/:memberId')
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN, RoleCode.SECRETAIRE)
  forMember(@Param('memberId') memberId: string) {
    return this.dues.listForMember(memberId);
  }

  @Post('generate')
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
  generate() {
    return this.dues.generateForMonth();
  }
}
