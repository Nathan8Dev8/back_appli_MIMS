import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ReceiptsService } from './receipts.service';

@UseGuards(JwtAuthGuard)
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.receipts.listForMember(user.memberId);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, receipt } = await this.receipts.getForDownload(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receipt.receiptNo}.pdf"`);
    res.send(buffer);
  }
}
