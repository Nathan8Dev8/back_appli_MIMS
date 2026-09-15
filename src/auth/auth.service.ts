import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async validateCredentials(username: string, password: string) {
    const account = await this.prisma.userAccount.findUnique({
      where: { username },
      include: { member: { include: { roles: { include: { role: true } } } } },
    });
    if (!account) throw new UnauthorizedException('Identifiants incorrects.');

    const valid = await argon2.verify(account.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Identifiants incorrects.');

    if (account.member.status !== 'ACTIF') {
      throw new UnauthorizedException("Ce compte n'est plus actif. Contactez un responsable.");
    }

    return account;
  }

  async login(username: string, password: string) {
    const account = await this.validateCredentials(username, password);
    const roles = account.member.roles.filter((r) => r.actif).map((r) => r.role.code);

    await this.prisma.userAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      actorId: account.memberId,
      action: 'LOGIN',
      entityType: 'UserAccount',
      entityId: account.id,
    });

    const payload = { sub: account.memberId, username: account.username, roles };
    return {
      accessToken: this.jwt.sign(payload),
      mustChangePassword: account.mustChangePassword,
      member: {
        id: account.member.id,
        firstName: account.member.firstName,
        lastName: account.member.lastName,
        avatarUrl: account.member.avatarUrl,
        roles,
      },
    };
  }

  async changePassword(memberId: string, currentPassword: string, newPassword: string) {
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { memberId } });
    const valid = await argon2.verify(account.passwordHash, currentPassword);
    if (!valid) throw new UnauthorizedException('Mot de passe actuel incorrect.');

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.userAccount.update({
      where: { id: account.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.audit.log({
      actorId: memberId,
      action: 'CHANGE_PASSWORD',
      entityType: 'UserAccount',
      entityId: account.id,
    });
    return { success: true };
  }

  async me(memberId: string) {
    const member = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      include: { roles: { include: { role: true }, where: { actif: true } } },
    });
    return {
      id: member.id,
      memberCode: member.memberCode,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      email: member.email,
      address: member.address,
      birthDate: member.birthDate,
      avatarUrl: member.avatarUrl,
      whatsappActive: member.whatsappActive,
      preferredChannel: member.preferredChannel,
      joinedAt: member.joinedAt,
      status: member.status,
      roles: member.roles.map((r) => r.role.code),
    };
  }
}
