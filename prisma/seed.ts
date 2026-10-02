/* eslint-disable no-console */
import { PrismaClient, RoleCode } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Base locale : supprime tous les comptes (et tout ce qui en dépend), puis crée
 * un utilisateur par profil.
 * Base distante (SEED_ALLOW_REMOTE=1) : n'efface rien ; crée les mêmes comptes
 * uniquement si la base n'a aucun membre, avec changement de mot de passe obligatoire.
 */
const prisma = new PrismaClient();

const ROLE_LABELS: Record<RoleCode, string> = {
  MEMBRE: 'Membre',
  SECRETAIRE: 'Secrétaire',
  TRESORIER: 'Trésorier',
  PRESIDENT_ADMIN: 'Président / Administrateur',
  PASTEUR_ENCADREUR: 'Pasteur / Encadreur',
};

const USERS: { firstName: string; lastName: string; phone: string; username: string; password: string; role: RoleCode }[] = [
  { firstName: 'Grâce', lastName: 'Amoussou', phone: '+237 6 90 00 00 01', username: 'president', password: 'MimsAdmin#2026', role: 'PRESIDENT_ADMIN' },
  { firstName: 'Samuel', lastName: 'Kodjo', phone: '+237 6 90 00 00 02', username: 'tresorier', password: 'MimsTresor#2026', role: 'TRESORIER' },
  { firstName: 'Esther', lastName: 'Dossou', phone: '+237 6 90 00 00 03', username: 'secretaire', password: 'MimsSecret#2026', role: 'SECRETAIRE' },
  { firstName: 'Daniel', lastName: 'Houngbo', phone: '+237 6 90 00 00 04', username: 'pasteur', password: 'MimsPasteur#2026', role: 'PASTEUR_ENCADREUR' },
  { firstName: 'Josué', lastName: 'Adjovi', phone: '+237 6 90 00 00 05', username: 'membre', password: 'MimsMembre#2026', role: 'MEMBRE' },
];

async function main() {
  const local = /@(localhost|127\.0\.0\.1|db)[:/]/.test(process.env.DATABASE_URL ?? '');

  if (local) {
    // Tout ce qui référence un membre part avec lui (CASCADE) ; les rôles et l'historique des migrations restent.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE members, audit_logs RESTART IDENTITY CASCADE');
  } else {
    // Base distante (production) : on n'efface jamais rien, on crée seulement les comptes dans une base vide.
    if (process.env.SEED_ALLOW_REMOTE !== '1') throw new Error('Base distante : relance avec SEED_ALLOW_REMOTE=1 pour créer les comptes.');
    const existing = await prisma.member.count();
    if (existing) throw new Error(`La base contient déjà ${existing} membre(s) : rien n'a été créé.`);
  }

  const roles = Object.fromEntries(
    await Promise.all(
      Object.values(RoleCode).map(async (code) => [code, await prisma.role.upsert({ where: { code }, update: {}, create: { code, label: ROLE_LABELS[code] } })]),
    ),
  );

  for (const [i, u] of USERS.entries()) {
    const roleCodes = u.role === 'MEMBRE' ? ['MEMBRE'] : [u.role, 'MEMBRE'];
    await prisma.member.create({
      data: {
        memberCode: `JM-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        status: 'ACTIF',
        // En production, ces mots de passe sont connus (README) : chacun devra choisir le sien à la première connexion.
        account: { create: { username: u.username, passwordHash: await argon2.hash(u.password), mustChangePassword: !local } },
        roles: { create: roleCodes.map((code) => ({ roleId: roles[code].id })) },
        // Le simple membre garde l'écran de bienvenue à faire, pour pouvoir le tester.
        onboarding: { create: u.role === 'MEMBRE' ? {} : { status: 'TERMINE', completedAt: new Date() } },
      },
    });
  }

  console.log('\nComptes créés :');
  console.table(USERS.map((u) => ({ profil: ROLE_LABELS[u.role], identifiant: u.username, 'mot de passe': u.password })));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
