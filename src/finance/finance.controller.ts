import { BadRequestException, Body, Controller, Get, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  ALL_NATURES,
  FinanceService,
  TransactionFilter,
  TxDirection,
  TxNature,
  TxStatus,
} from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { CancelExpenseDto, CreateExpenseDto } from './dto/create-expense.dto';
import { CreateCollecteDto } from './dto/create-collecte.dto';

const DAY_MS = 24 * 3600 * 1000;

function parseDay(value: string | undefined, name: string) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`Paramètre « ${name} » invalide (attendu : AAAA-MM-JJ).`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function parseFilter(q: Record<string, string | undefined>): TransactionFilter {
  if (q.direction && !['ENTREE', 'SORTIE'].includes(q.direction)) throw new BadRequestException('Type invalide.');
  if (q.nature && !(ALL_NATURES as readonly string[]).includes(q.nature)) throw new BadRequestException('Nature invalide.');
  if (q.status && !['VALIDE', 'ANNULE', 'EN_ATTENTE'].includes(q.status)) throw new BadRequestException('Statut invalide.');
  const from = parseDay(q.from, 'from');
  const toDay = parseDay(q.to, 'to');
  return {
    direction: q.direction as TxDirection | undefined,
    nature: q.nature as TxNature | undefined,
    status: q.status as TxStatus | undefined,
    from,
    to: toDay ? new Date(toDay.getTime() + DAY_MS) : undefined, // « to » est inclus dans la recherche
    q: q.q?.slice(0, 100),
  };
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.TRESORIER, RoleCode.PRESIDENT_ADMIN)
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService, private readonly exporter: FinanceExportService) {}

  @Get('summary')
  summary() {
    return this.finance.summary();
  }

  @Get('members')
  members() {
    return this.finance.membersStatus();
  }

  @Get('cotisation-preview')
  preview(@Query('memberId') memberId: string, @Query('amount') amount: string, @Query('paidAt') paidAt?: string) {
    if (!memberId) throw new BadRequestException('Membre manquant.');
    return this.finance.cotisationPreview(memberId, Number(amount), paidAt);
  }

  @Get('transactions')
  transactions(@Query() query: Record<string, string | undefined>) {
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 100);
    return this.finance.transactions(parseFilter(query), Number(query.page) || 1, pageSize);
  }

  @Get('reminders/preview')
  reminderPreview() {
    return this.finance.reminderPreview();
  }

  @Post('reminders/send')
  sendReminders(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.sendReminders(user.memberId);
  }

  @Get('report/export')
  async exportReport(@Query('year') year?: string, @Query('month') month?: string) {
    const { buffer, filename } = await this.exporter.buildReport(
      year ? Number(year) : new Date().getUTCFullYear(),
      month ? Number(month) : undefined,
    );
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('expenses')
  createExpense(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.finance.createExpense(dto, user.memberId);
  }

  @Post('expenses/:id/cancel')
  cancelExpense(@Param('id') id: string, @Body() dto: CancelExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.finance.cancelExpense(id, dto, user.memberId);
  }

  @Get('collectes')
  collectes() {
    return this.finance.listCollectes();
  }

  @Get('collectes/:id')
  collecte(@Param('id') id: string) {
    return this.finance.getCollecte(id);
  }

  @Post('collectes')
  createCollecte(@Body() dto: CreateCollecteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.finance.createCollecte(dto, user.memberId);
  }

  @Post('collectes/:id/close')
  closeCollecte(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.finance.closeCollecte(id, user.memberId);
  }
}
