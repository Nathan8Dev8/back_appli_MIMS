import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Seules routes ouvertes tant que le mot de passe provisoire n'a pas été changé. */
const ALLOWED_WITH_TEMPORARY_PASSWORD = ['/api/auth/me', '/api/auth/change-password'];

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext) {
    const ok = (await super.canActivate(context)) as boolean;
    const request = context.switchToHttp().getRequest();
    // Le mot de passe provisoire (communiqué par le Président) ne doit pas suffire pour utiliser l'appli :
    // l'API l'impose elle-même, pas seulement l'écran.
    if (ok && request.user?.mustChangePassword && !ALLOWED_WITH_TEMPORARY_PASSWORD.includes(request.path)) {
      throw new ForbiddenException('Change d’abord ton mot de passe provisoire.');
    }
    return ok;
  }
}
