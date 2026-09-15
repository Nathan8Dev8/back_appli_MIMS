import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.listForMember(user.memberId);
  }

  @Get()
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
  all() {
    return this.payments.listAll();
  }

  @Post()
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
  create(@Body() dto: CreatePaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.create(dto, user.memberId);
  }

  @Post(':id/confirm')
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
  confirm(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.confirm(id, user.memberId);
  }

  @Post(':id/reverse')
  @Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
  reverse(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.reverse(id, user.memberId, reason ?? 'Contre-passation');
  }
}
