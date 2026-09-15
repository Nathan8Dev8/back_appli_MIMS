import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.PRESIDENT_ADMIN)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('entityType') entityType?: string) {
    return this.prisma.auditLog.findMany({
      where: entityType ? { entityType } : {},
      orderBy: { occurredAt: 'desc' },
      take: 300,
    });
  }
}
