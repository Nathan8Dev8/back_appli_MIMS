import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../database/prisma.service';
import { jwtSecret } from './jwt-secret';

interface JwtPayload {
  sub: string;
  username: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  /**
   * Un token peut rester valide (non expiré) alors que le membre a été
   * supprimé ou désactivé entre-temps. On vérifie donc systématiquement
   * son existence ici plutôt que de laisser chaque contrôleur planter sur
   * un "record not found" — toute route protégée reçoit alors un 401 propre.
   */
  async validate(payload: JwtPayload) {
    const member = await this.prisma.member.findUnique({
      where: { id: payload.sub },
      include: { account: { select: { mustChangePassword: true } }, roles: { where: { actif: true }, select: { role: { select: { code: true } } } } },
    });
    if (!member || member.status !== 'ACTIF') {
      throw new UnauthorizedException('Ta session a expiré, reconnecte-toi.');
    }
    // Rôles relus en base à chaque requête : un rôle retiré cesse de compter immédiatement,
    // même si le jeton (12 h) a été émis avant.
    return {
      memberId: payload.sub,
      username: payload.username,
      roles: member.roles.map((r) => r.role.code),
      mustChangePassword: member.account?.mustChangePassword ?? false,
    };
  }
}
