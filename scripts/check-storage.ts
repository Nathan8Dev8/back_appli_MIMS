/**
 * Vérifie la configuration S3 : envoie un petit fichier puis le relit, comme le
 * fait l'API. Le bucket peut (et devrait) rester privé.
 *
 *   npm run storage:check
 */
import { StorageService } from '../src/common/storage/storage.service';

try {
  process.loadEnvFile('.env');
} catch {
  // pas de .env : on utilise les variables déjà présentes dans l'environnement
}

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const ko = (msg: string) => console.log(`  ❌ ${msg}`);

async function main() {
  console.log('\nVérification du stockage de fichiers\n');
  if (!process.env.S3_BUCKET) {
    ko('S3_BUCKET n\'est pas défini dans api/.env : les fichiers restent sur le disque local.');
    process.exit(1);
  }
  const missing = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !process.env[k]);
  if (missing.length) console.log(`  ⚠️  Variables absentes : ${missing.join(', ')}`);
  console.log(`  Bucket : ${process.env.S3_BUCKET}`);
  console.log(`  Endpoint : ${process.env.S3_ENDPOINT ?? '(AWS par défaut)'}\n`);

  const storage = new StorageService();
  const key = `healthcheck/test-${Date.now()}.txt`;
  const content = Buffer.from(`Jeunes MIMS, test de stockage du ${new Date().toISOString()}`);

  let failed = false;

  try {
    await storage.put(key, content, 'text/plain');
    ok('Envoi du fichier de test : réussi (les clés et le bucket sont bons).');
  } catch (err: any) {
    const cause = err?.cause ?? err;
    ko(`Envoi refusé : ${cause?.name ?? 'erreur'} : ${cause?.message ?? cause}`);
    console.log('     → Vérifie S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY et le nom du bucket.');
    process.exit(1);
  }

  try {
    const back = await storage.get(key);
    back.equals(content) ? ok('Lecture par l\'API : réussie (photos, reçus et documents fonctionneront).') : ((failed = true), ko('Lecture par l\'API : contenu différent.'));
  } catch (err: any) {
    failed = true;
    ko(`Lecture par l'API impossible : ${err?.message ?? err}`);
  }

  console.log(failed ? '\nCertains tests ont échoué : corrige puis relance.\n' : '\nTout fonctionne 🎉\n');
  process.exit(failed ? 1 : 0);
}

main();
