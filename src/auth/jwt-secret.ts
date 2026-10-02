import { Logger } from '@nestjs/common';

/**
 * Secret de signature des jetons. Aucune valeur par défaut : un secret connu
 * permettrait à n'importe qui de fabriquer un jeton « Président ».
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant : définis-le dans les variables d’environnement.');
  if (secret.length < 32) {
    const message = 'JWT_SECRET trop court (32 caractères minimum, idéalement 64 aléatoires).';
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    new Logger('Sécurité').warn(message);
  }
  return secret;
}
