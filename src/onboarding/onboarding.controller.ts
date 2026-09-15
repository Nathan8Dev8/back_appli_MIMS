import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.SECRETAIRE, RoleCode.PRESIDENT_ADMIN)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list() {
    return this.onboarding.list();
  }

  @Post(':memberId/welcome')
  sendWelcome(@Param('memberId') memberId: string) {
    return this.onboarding.sendWelcome(memberId);
  }

  @Post(':memberId/regulation')
  sendRegulation(@Param('memberId') memberId: string, @Body('documentId') documentId: string) {
    return this.onboarding.sendRegulation(memberId, documentId);
  }
}
