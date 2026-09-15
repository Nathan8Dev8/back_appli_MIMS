/* eslint-disable no-console */
import { PrismaClient, RoleCode } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import PDFDocument from 'pdfkit';

const prisma = new PrismaClient();
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? join(process.cwd(), 'storage');

async function storeFile(key: string, buffer: Buffer) {
  const fullPath = join(STORAGE_ROOT, key);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, buffer);
  return { storageKey: key, sha256: createHash('sha256').update(buffer).digest('hex') };
}

function simplePdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fillColor('#113E7D').fontSize(20).text('Jeunes MIMS', { align: 'left' });
    doc.moveDown();
    doc.fillColor('#111827').fontSize(12);
    for (const line of lines) doc.text(line);
    doc.end();
  });
}

const ROLE_LABELS: Record<RoleCode, string> = {
  MEMBRE: 'Membre',
  SECRETAIRE: 'Secrétaire',
  TRESORIER: 'Trésorier',
  PRESIDENT_ADMIN: 'Président / Administrateur',
  PASTEUR_ENCADREUR: 'Pasteur / Encadreur',
};

async function upsertRole(code: RoleCode) {
  return prisma.role.upsert({ where: { code }, update: {}, create: { code, label: ROLE_LABELS[code] } });
}

let memberCounter = 0;
async function upsertMember(opts: {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  username: string;
  password: string;
  mustChangePassword?: boolean;
  roles: RoleCode[];
  birthDate?: Date;
  whatsappActive?: boolean;
}) {
  memberCounter += 1;
  const memberCode = `JM-2026-${String(memberCounter).padStart(4, '0')}`;
  const passwordHash = await argon2.hash(opts.password);

  const roleRecords = await Promise.all(opts.roles.map((r) => upsertRole(r)));

  const existingAccount = await prisma.userAccount.findUnique({ where: { username: opts.username } });
  if (existingAccount) {
    console.log(`↺  ${opts.username} existe déjà, ignoré.`);
    return prisma.member.findUniqueOrThrow({ where: { id: existingAccount.memberId } });
  }

  const member = await prisma.member.create({
    data: {
      memberCode,
      firstName: opts.firstName,
      lastName: opts.lastName,
      phone: opts.phone,
      email: opts.email,
      birthDate: opts.birthDate,
      whatsappActive: opts.whatsappActive ?? false,
      preferredChannel: opts.whatsappActive ? 'WHATSAPP' : 'PUSH',
      status: 'ACTIF',
      account: {
        create: { username: opts.username, passwordHash, mustChangePassword: opts.mustChangePassword ?? false },
      },
      roles: { create: roleRecords.map((r) => ({ roleId: r.id })) },
      onboarding: { create: { status: 'TERMINE', welcomeSentAt: new Date() } },
    },
  });
  console.log(`✔  ${opts.firstName} ${opts.lastName} — ${opts.username} / ${opts.password}`);
  return member;
}

async function main() {
  console.log('\n🌱  Initialisation des données de démonstration — Jeunes MIMS\n');

  for (const code of Object.values(RoleCode)) await upsertRole(code);

  const president = await upsertMember({
    firstName: 'Grâce',
    lastName: 'Amoussou',
    phone: '+229 97 00 00 01',
    email: 'presidente@jeunes-mims.org',
    username: 'president',
    password: 'MimsAdmin#2026',
    roles: [RoleCode.PRESIDENT_ADMIN, RoleCode.MEMBRE],
  });

  const tresorier = await upsertMember({
    firstName: 'Samuel',
    lastName: 'Kodjo',
    phone: '+229 97 00 00 02',
    email: 'tresorier@jeunes-mims.org',
    username: 'tresorier',
    password: 'MimsTresor#2026',
    roles: [RoleCode.TRESORIER, RoleCode.MEMBRE],
  });

  await upsertMember({
    firstName: 'Esther',
    lastName: 'Dossou',
    phone: '+229 97 00 00 03',
    email: 'secretaire@jeunes-mims.org',
    username: 'secretaire',
    password: 'MimsSecret#2026',
    roles: [RoleCode.SECRETAIRE, RoleCode.MEMBRE],
  });

  await upsertMember({
    firstName: 'Pasteur Élie',
    lastName: 'Houngbo',
    phone: '+229 97 00 00 04',
    email: 'pasteur@jeunes-mims.org',
    username: 'pasteur',
    password: 'MimsPasteur#2026',
    roles: [RoleCode.PASTEUR_ENCADREUR, RoleCode.MEMBRE],
  });

  const today = new Date();
  const membre1 = await upsertMember({
    firstName: 'Josué',
    lastName: 'Adjovi',
    phone: '+229 96 11 22 33',
    username: 'josue.adjovi',
    password: 'Bienvenue#2026',
    mustChangePassword: true,
    roles: [RoleCode.MEMBRE],
    birthDate: new Date(Date.UTC(2004, today.getUTCMonth(), today.getUTCDate())),
    whatsappActive: true,
  });

  const membre2 = await upsertMember({
    firstName: 'Naomie',
    lastName: 'Zannou',
    phone: '+229 96 22 33 44',
    username: 'naomie.zannou',
    password: 'Bienvenue#2026',
    mustChangePassword: true,
    roles: [RoleCode.MEMBRE],
    birthDate: new Date(Date.UTC(2003, 5, 14)),
  });

  await upsertMember({
    firstName: 'David',
    lastName: 'Toko',
    phone: '+229 96 33 44 55',
    username: 'david.toko',
    password: 'Bienvenue#2026',
    mustChangePassword: true,
    roles: [RoleCode.MEMBRE],
    birthDate: new Date(Date.UTC(2005, 2, 2)),
  });

  await upsertMember({
    firstName: 'Rébecca',
    lastName: 'Aholou',
    phone: '+229 96 44 55 66',
    username: 'rebecca.aholou',
    password: 'Bienvenue#2026',
    mustChangePassword: true,
    roles: [RoleCode.MEMBRE],
    birthDate: new Date(Date.UTC(2002, 9, 21)),
    whatsappActive: true,
  });

  // ---- Cotisations du mois courant pour tous les membres actifs ----
  const dueMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const dueDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 10));
  const activeMembers = await prisma.member.findMany({ where: { status: 'ACTIF' } });
  for (const member of activeMembers) {
    await prisma.monthlyDue.upsert({
      where: { memberId_dueMonth: { memberId: member.id, dueMonth } },
      update: {},
      create: {
        memberId: member.id,
        dueMonth,
        amountDue: 500,
        amountPaid: 0,
        balance: 500,
        status: 'A_PAYER',
        dueDate,
      },
    });
  }
  console.log(`\n💰  Échéances de 500 FCFA créées pour ${activeMembers.length} membre(s).`);

  // ---- Un paiement validé de démonstration, avec reçu PDF réel ----
  const due = await prisma.monthlyDue.findUniqueOrThrow({
    where: { memberId_dueMonth: { memberId: membre1.id, dueMonth } },
  });
  const payment = await prisma.payment.create({
    data: {
      paymentRef: `PMT-SEED-${Date.now()}`,
      memberId: membre1.id,
      amount: 500,
      method: 'MOBILE_MONEY',
      status: 'VALIDE',
      enteredById: tresorier.id,
      allocations: { create: { dueId: due.id, amountAllocated: 500 } },
    },
  });
  await prisma.monthlyDue.update({ where: { id: due.id }, data: { amountPaid: 500, balance: 0, status: 'PAYE' } });

  const receiptPdf = await simplePdf([
    'Reçu officiel de cotisation',
    `Membre : ${membre1.firstName} ${membre1.lastName}`,
    `Code membre : ${membre1.memberCode}`,
    'Montant reçu : 500 FCFA',
    'Mode de paiement : Mobile Money',
    'Merci pour ta fidélité !',
  ]);
  const { storageKey, sha256 } = await storeFile(`receipts/${membre1.id}/seed-receipt.pdf`, receiptPdf);
  await prisma.receipt.create({
    data: { paymentId: payment.id, receiptNo: `RCPT-${today.getFullYear()}-00001`, storageKey, sha256 },
  });
  console.log('🧾  Paiement de démonstration validé avec reçu PDF.');

  // ---- Documents ----
  const reglementPdf = await simplePdf([
    'Règlement intérieur — Jeunes MIMS',
    '',
    'Article 1 — Nous formons une communauté fondée sur la foi, le respect et la solidarité.',
    'Article 2 — La cotisation mensuelle est fixée à 500 FCFA.',
    'Article 3 — Toute absence prolongée doit être signalée au secrétariat.',
  ]);
  const reglementFile = await storeFile('documents/seed/reglement-interieur.pdf', reglementPdf);
  const reglement = await prisma.document.create({
    data: {
      documentCode: 'DOC-2026-0001',
      type: 'REGLEMENT',
      title: 'Règlement intérieur 2026',
      description: 'Le règlement intérieur qui encadre la vie de notre communauté.',
      storageKey: reglementFile.storageKey,
      sha256: reglementFile.sha256,
      status: 'PUBLIE',
      publishedAt: new Date(),
      publishedById: president.id,
    },
  });

  const pvPdf = await simplePdf([
    'Procès-verbal — Réunion mensuelle',
    '',
    'Présents : Bureau exécutif et 12 membres.',
    "Ordre du jour : bilan financier, préparation de la retraite spirituelle, sondage sur l'horaire des rencontres.",
  ]);
  const pvFile = await storeFile('documents/seed/pv-reunion.pdf', pvPdf);
  await prisma.document.create({
    data: {
      documentCode: 'DOC-2026-0002',
      type: 'PV',
      title: 'PV — Réunion mensuelle de janvier',
      storageKey: pvFile.storageKey,
      sha256: pvFile.sha256,
      status: 'PUBLIE',
      publishedAt: new Date(),
      publishedById: president.id,
    },
  });

  await prisma.onboarding.updateMany({
    where: {},
    data: { regulationDocumentId: reglement.id },
  });
  console.log('📄  Documents (règlement + PV) publiés.');

  // ---- Événement ----
  const event = await prisma.event.create({
    data: {
      title: 'Veillée de louange & partage',
      description: "Une soirée de louange, de témoignages et de communion fraternelle pour bien démarrer l'année.",
      location: 'Temple central, Cotonou',
      startsAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      status: 'PLANIFIE',
      createdById: president.id,
    },
  });
  await prisma.eventParticipation.createMany({
    data: [
      { eventId: event.id, memberId: membre1.id, response: 'PRESENT', respondedAt: new Date() },
      { eventId: event.id, memberId: membre2.id, response: 'EN_ATTENTE' },
    ],
  });
  console.log('📅  Événement de démonstration créé.');

  // ---- Sondage ----
  const poll = await prisma.poll.create({
    data: {
      title: "Quel jour te convient le mieux pour la rencontre hebdomadaire ?",
      description: 'Aide-nous à choisir le meilleur créneau pour tout le monde.',
      options: { create: [{ label: 'Samedi après-midi' }, { label: 'Dimanche après le culte' }, { label: 'Vendredi soir' }] },
    },
    include: { options: true },
  });
  await prisma.vote.create({ data: { pollId: poll.id, optionId: poll.options[0].id, memberId: membre1.id } });
  console.log('🗳️  Sondage de démonstration créé.');

  // ---- Quiz ----
  await prisma.quiz.create({
    data: {
      title: 'Quiz biblique — Genèse',
      status: 'PUBLIE',
      publishedAt: new Date(),
      content: {
        questions: [
          {
            id: randomUUID(),
            question: 'Qui a construit une arche pour échapper au déluge ?',
            choices: ['Abraham', 'Noé', 'Moïse', 'David'],
            correctIndex: 1,
          },
          {
            id: randomUUID(),
            question: "En combien de jours Dieu a-t-il créé le monde selon la Genèse ?",
            choices: ['6', '7', '10', '40'],
            correctIndex: 0,
          },
        ],
      },
    },
  });
  console.log('🧠  Quiz de démonstration créé.');

  console.log('\n✅  Données de démonstration prêtes. Identifiants de connexion :');
  console.log('   • Président/Admin  → president / MimsAdmin#2026');
  console.log('   • Trésorier        → tresorier / MimsTresor#2026');
  console.log('   • Secrétaire       → secretaire / MimsSecret#2026');
  console.log('   • Pasteur          → pasteur / MimsPasteur#2026');
  console.log('   • Membre (démo)    → josue.adjovi / Bienvenue#2026  (changement de mot de passe requis)\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
