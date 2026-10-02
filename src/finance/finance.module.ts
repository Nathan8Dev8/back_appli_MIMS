import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceExportService],
  exports: [FinanceService],
})
export class FinanceModule {}
