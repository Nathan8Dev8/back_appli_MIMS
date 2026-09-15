import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const MAX_AVATAR_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — marge confortable pour une photo de smartphone

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(search?: string, status?: string) {
    return this.prisma.member.findMany({
      where: {
        AND: [
          status ? { status: status as any } : {},
          search
            ? {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search } },
                  { memberCode: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      include: { roles: { include: { role: true }, where: { actif: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(id: string) {
    const member = await this.prisma.member.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!member) throw new NotFoundException('Membre introuvable.');
    return member;
  }

  async create(dto: CreateMemberDto, actorId?: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.member.count();
    const memberCode = `JM-${year}-${String(count + 1).padStart(4, '0')}`;

    const baseUsername = slugify(`${dto.firstName}.${dto.lastName}`) || `membre${count + 1}`;
    let username = baseUsername;
    let suffix = 1;
    while (await this.prisma.userAccount.findUnique({ where: { username } })) {
      username = `${baseUsername}${suffix++}`;
    }
    const temporaryPassword = randomUUID().split('-')[0];
    const passwordHash = await argon2.hash(temporaryPassword);

    const memberRole = await this.prisma.role.upsert({
      where: { code: 'MEMBRE' },
      update: {},
      create: { code: 'MEMBRE', label: 'Membre' },
    });

    const roleIdsToAssign = [memberRole.id];
    if (dto.role && dto.role !== 'MEMBRE') {
      const additionalRole = await this.prisma.role.findUniqueOrThrow({ where: { code: dto.role } });
      roleIdsToAssign.push(additionalRole.id);
    }

    const member = await this.prisma.member.create({
      data: {
        memberCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        whatsappActive: dto.whatsappActive ?? false,
        preferredChannel: dto.preferredChannel ?? 'PUSH',
        account: { create: { username, passwordHash, mustChangePassword: true } },
        roles: { create: roleIdsToAssign.map((roleId) => ({ roleId })) },
        onboarding: { create: {} },
      },
      include: { account: true },
    });

    await this.audit.log({
      actorId,
      action: 'CREATE_MEMBER',
      entityType: 'Member',
      entityId: member.id,
      after: { memberCode, firstName: dto.firstName, lastName: dto.lastName, role: dto.role ?? 'MEMBRE' },
    });

    return { ...member, temporaryPassword, username };
  }

  async updateProfile(memberId: string, dto: UpdateProfileDto) {
    const before = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    const member = await this.prisma.member.update({
      where: { id: memberId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        whatsappActive: dto.whatsappActive,
        preferredChannel: dto.preferredChannel,
      },
    });
    await this.audit.log({
      actorId: memberId,
      action: 'UPDATE_PROFILE',
      entityType: 'Member',
      entityId: memberId,
      before,
      after: member,
    });
    return member;
  }

  async updateAvatar(memberId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Format non pris en charge (${file.mimetype || 'inconnu'}). Utilise une photo JPEG, PNG ou WEBP — si ta photo vient d'un iPhone au format HEIC, choisis « la plus compatible » dans les réglages Appareil photo, ou exporte-la en JPEG avant l'envoi.`,
      );
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new BadRequestException(
        `La photo pèse ${(file.size / (1024 * 1024)).toFixed(1)} Mo, ce qui dépasse la limite de 10 Mo. Réduis-la ou choisis-en une autre.`,
      );
    }

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `avatars/${memberId}/${randomUUID()}.${ext}`;
    const { url } = await this.storage.put(key, file.buffer, file.mimetype);

    const member = await this.prisma.member.update({
      where: { id: memberId },
      data: { avatarUrl: url },
    });

    await this.audit.log({
      actorId: memberId,
      action: 'UPDATE_AVATAR',
      entityType: 'Member',
      entityId: memberId,
      after: { avatarUrl: member.avatarUrl },
    });

    return member;
  }

  async setStatus(memberId: string, status: string, actorId?: string) {
    const before = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    const member = await this.prisma.member.update({
      where: { id: memberId },
      data: { status: status as any },
    });
    await this.audit.log({
      actorId,
      action: 'UPDATE_MEMBER_STATUS',
      entityType: 'Member',
      entityId: memberId,
      before: { status: before.status },
      after: { status: member.status },
    });
    return member;
  }
}
