import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { StorageService } from '../common/storage/storage.service';

@Module({
  controllers: [MembersController],
  providers: [MembersService, StorageService],
  exports: [MembersService],
})
export class MembersModule {}
