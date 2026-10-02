import { Body, Controller, Delete, Headers, Post, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe-push.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService, private readonly notifications: NotificationsService) {}

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

  /** Notification d'essai : permet de vérifier, appli fermée, qu'elle s'affiche bien sur l'écran. */
  @Post('test')
  test(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.notifyMember(
      user.memberId,
      'AUTRE',
      'Ça marche 🎉',
      'Les notifications des Jeunes MIMS arrivent bien sur cet appareil.',
      '/mon-profil',
    );
  }

}
