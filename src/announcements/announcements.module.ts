import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { StorageService } from '../common/storage/storage.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, StorageService],
})
export class AnnouncementsModule {}
