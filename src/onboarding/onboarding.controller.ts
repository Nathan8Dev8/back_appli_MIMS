import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.mine(user.memberId);
  }

  @Post('me/complete')
  complete(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.complete(user.memberId);
  }

  @Post(':memberId/remind')
  @Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
  remind(@Param('memberId') memberId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.remind(memberId, user.memberId);
  }
}
