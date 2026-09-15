import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { AppController } from './app.controller';
import { PrismaModule } from './database/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { StorageModule } from './common/storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { RolesModule } from './roles/roles.module';
import { DuesModule } from './dues/dues.module';
import { PaymentsModule } from './payments/payments.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { DocumentsModule } from './documents/documents.module';
import { EventsModule } from './events/events.module';
import { PollsModule } from './polls/polls.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuditHttpModule } from './audit/audit-http.module';
import { ReportsModule } from './reports/reports.module';
import { JobsModule } from './jobs/jobs.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
    ServeStaticModule.forRoot({
      rootPath: process.env.STORAGE_ROOT ?? join(process.cwd(), 'storage'),
      serveRoot: '/files',
    }),
    PrismaModule,
    AuditModule,
    StorageModule,
    AuthModule,
    MembersModule,
    RolesModule,
    DuesModule,
    PaymentsModule,
    ReceiptsModule,
    DocumentsModule,
    EventsModule,
    PollsModule,
    QuizzesModule,
    NotificationsModule,
    OnboardingModule,
    AuditHttpModule,
    ReportsModule,
    JobsModule,
    AnnouncementsModule,
    PushModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
