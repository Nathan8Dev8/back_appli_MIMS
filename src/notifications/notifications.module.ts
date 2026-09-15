import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { WebPushChannelAdapter } from './adapters/web-push-channel.adapter';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, WebPushChannelAdapter],
  exports: [NotificationsService],
})
export class NotificationsModule {}
