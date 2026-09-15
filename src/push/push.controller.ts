import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe-push.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('subscribe')
  subscribe(
    @Body() dto: SubscribePushDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user.memberId, dto, userAgent);
  }

  @Delete('subscribe')
  unsubscribe(@Body() dto: UnsubscribePushDto, @CurrentUser() user: AuthenticatedUser) {
    return this.push.unsubscribe(user.memberId, dto.endpoint);
  }

  @Get('devices')
  myDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.push.listMyDevices(user.memberId);
  }
}
