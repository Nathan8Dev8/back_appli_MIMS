import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushService } from './push.service';
import { PushController } from './push.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [PushController],
  providers: [PushService],
})
export class PushModule {}
