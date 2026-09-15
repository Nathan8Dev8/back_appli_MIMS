import { Injectable } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';

const ROLE_LABELS: Record<RoleCode, string> = {
  MEMBRE: 'Membre',
  SECRETAIRE: 'Secrétaire',
  TRESORIER: 'Trésorier',
  PRESIDENT_ADMIN: 'Président / Administrateur',
  PASTEUR_ENCADREUR: 'Pasteur / Encadreur',
};

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async ensureSeeded() {
    for (const code of Object.values(RoleCode)) {
      await this.prisma.role.upsert({
        where: { code },
        update: {},
        create: { code, label: ROLE_LABELS[code] },
      });
    }
  }

  list() {
    return this.prisma.role.findMany({ orderBy: { code: 'asc' } });
  }

  async assign(memberId: string, roleCode: RoleCode, actorId?: string) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const assignment = await this.prisma.memberRole.upsert({
      where: { memberId_roleId: { memberId, roleId: role.id } },
      update: { actif: true, endedAt: null },
      create: { memberId, roleId: role.id },
    });
    await this.audit.log({
      actorId,
      action: 'ASSIGN_ROLE',
      entityType: 'Member',
      entityId: memberId,
      after: { role: roleCode },
    });
    return assignment;
  }

  async revoke(memberId: string, roleCode: RoleCode, actorId?: string) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const assignment = await this.prisma.memberRole.update({
      where: { memberId_roleId: { memberId, roleId: role.id } },
      data: { actif: false, endedAt: new Date() },
    });
    await this.audit.log({
      actorId,
      action: 'REVOKE_ROLE',
      entityType: 'Member',
      entityId: memberId,
      after: { role: roleCode },
    });
    return assignment;
  }
}
