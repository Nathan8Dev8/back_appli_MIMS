import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../database/prisma.service';

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
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    });
  }

  /**
   * Un token peut rester valide (non expiré) alors que le membre a été
   * supprimé ou désactivé entre-temps. On vérifie donc systématiquement
   * son existence ici plutôt que de laisser chaque contrôleur planter sur
   * un "record not found" — toute route protégée reçoit alors un 401 propre.
   */
  async validate(payload: JwtPayload) {
    const member = await this.prisma.member.findUnique({ where: { id: payload.sub } });
    if (!member || member.status !== 'ACTIF') {
      throw new UnauthorizedException('Session expirée, merci de te reconnecter.');
    }
    return { memberId: payload.sub, username: payload.username, roles: payload.roles };
  }
}
