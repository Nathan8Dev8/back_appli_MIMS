import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';
import { StorageService } from '../common/storage/storage.service';

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService, StorageService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
