import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';

// Module HTTP dédié à la consultation du journal d'audit (le service
// d'écriture `AuditService` est fourni globalement par `AuditModule`).
@Module({
  controllers: [AuditController],
})
export class AuditHttpModule {}
