import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
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
import { ComplaintsModule } from './complaints/complaints.module';
import { FeedbackModule } from './feedback/feedback.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuditHttpModule } from './audit/audit-http.module';
import { ReportsModule } from './reports/reports.module';
import { JobsModule } from './jobs/jobs.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PushModule } from './push/push.module';
import { FinanceModule } from './finance/finance.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
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
    ComplaintsModule,
    FeedbackModule,
    NotificationsModule,
    OnboardingModule,
    AuditHttpModule,
    ReportsModule,
    JobsModule,
    AnnouncementsModule,
    PushModule,
    FinanceModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
