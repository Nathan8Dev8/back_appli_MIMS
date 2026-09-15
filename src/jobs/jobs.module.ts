import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { DuesModule } from '../dues/dues.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ScheduleModule.forRoot(), DuesModule, NotificationsModule],
  providers: [JobsService],
})
export class JobsModule {}
