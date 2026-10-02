import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { DuesModule } from '../dues/dues.module';

@Module({
  imports: [OnboardingModule, DuesModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
