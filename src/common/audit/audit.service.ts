import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

const GENESIS_HASH = '0'.repeat(64);

/**
 * Journal d'audit append-only, chaîné par hash (hash_prev/hash_current)
 * afin de garantir qu'aucune entrée ne puisse être modifiée ou supprimée
 * sans casser la chaîne — cf. cahier des charges §9 Sécurité.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  }) {
    const last = await this.prisma.auditLog.findFirst({
      orderBy: { occurredAt: 'desc' },
    });
    const hashPrev = last?.hashCurrent ?? GENESIS_HASH;
    const occurredAt = new Date();
    const payload = JSON.stringify({
      actorId: params.actorId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      occurredAt: occurredAt.toISOString(),
      before: params.before ?? null,
      after: params.after ?? null,
      hashPrev,
    });
    const hashCurrent = createHash('sha256').update(payload).digest('hex');

    return this.prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        occurredAt,
        beforeJson: (params.before ?? null) as any,
        afterJson: (params.after ?? null) as any,
        hashPrev,
        hashCurrent,
      },
    });
  }
}
