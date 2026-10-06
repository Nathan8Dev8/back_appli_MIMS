# Jeunes MIMS — Application communautaire

Application web/mobile (PWA) de gestion, de traçabilité et d'animation du
groupe de jeunesse **Jeunes MIMS** : membres, cotisations, paiements et
reçus, documents (règlement, PV), événements, sondages, quiz, notifications
et audit — conforme au cahier des charges fourni.

- **Frontend** : Next.js 14 (App Router) + TypeScript + Tailwind CSS — PWA installable, écran de préchargement animé avec le logo, design aux couleurs de la marque (`#113E7D` / `#F0F4F4`), typographie Sora (titres) / Plus Jakarta Sans (texte).
- **Backend** : NestJS + Prisma + PostgreSQL — authentification JWT, RBAC, transactions financières, génération de reçus PDF, journal d'audit chaîné par hash, tâches planifiées (cotisations, rappels, anniversaires…).
- **Stockage** : adaptateur de fichiers local en développement, à remplacer par S3/Supabase Storage en production (voir plus bas).
- **Notifications** : tout passe par l'appli. Chaque notification est gardée dans l'espace personnel et envoyée en Web Push (affichée sur l'écran même appli fermée, via clés VAPID — voir §2.2). WhatsApp / SMS / e-mail ne sont pas utilisés pour l'instant.
- **Annonces** : publication immédiate par le Pasteur/Encadreur, le Président/Admin ou la Secrétaire, pièce jointe optionnelle (image ou tout autre fichier), notification automatique à tous les membres.

```
api/   → API NestJS (port 4000)
web/   → PWA Next.js (port 3000)
docker-compose.yml → base PostgreSQL locale
```

---

## 1. Lancer le projet en local

### Prérequis

- Node.js ≥ 20
- Docker (pour PostgreSQL) — ou une instance PostgreSQL déjà disponible

### 1.1 Base de données

La base est exposée sur le port hôte **5433** (et non 5432) pour éviter tout
conflit avec une instance PostgreSQL déjà installée sur votre machine —
adaptez ce port si besoin dans `docker-compose.yml` et dans `DATABASE_URL`.

Avec Docker Compose (si `docker compose` est disponible sur votre machine) :

```bash
docker compose up -d db
```

ou 
docker start jeunes-mims-db

Si votre installation Docker ne fournit pas le plugin `compose`, lancez le
conteneur directement :

```bash
docker run -d --name jeunes-mims-db \
  -e POSTGRES_USER=jeunes_mims -e POSTGRES_PASSWORD=jeunes_mims -e POSTGRES_DB=jeunes_mims \
  -p 5433:5432 -v jeunes_mims_db_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

### 1.2 API (NestJS)

```bash
cd api
cp .env.example .env        # ajustez si besoin (JWT_SECRET, DATABASE_URL…)
npm install
npx prisma migrate dev --name init   # crée les tables
npm run prisma:seed                  # vide les comptes et crée un utilisateur par profil (base locale uniquement)
npm run start:dev                    # http://localhost:4000/api
```

Le seed supprime tous les comptes (et ce qui en dépend), puis crée un
utilisateur par profil. Il refuse de tourner sur une base distante.

### 1.3 Application web (Next.js PWA)

Dans un second terminal :

```bash
cd web
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                 # http://localhost:3000
```

Ouvrez [http://localhost:3000](http://localhost:3000). L'écran de
préchargement (logo Jeunes MIMS) s'affiche pendant l'initialisation, puis vous
êtes redirigé vers la connexion ou le tableau de bord.

> Le Service Worker est enregistré dès le développement (localhost est traité
> comme un contexte sécurisé par les navigateurs) — c'est nécessaire pour
> tester les notifications push en local. Si le cache te joue des tours
> pendant que tu codes, désenregistre-le depuis l'onglet Application des
> DevTools.

### 1.4 Notifications push (Web Push)

Génère une paire de clés avec `npx web-push generate-vapid-keys`, puis mets la
clé publique dans `VAPID_PUBLIC_KEY` (`api/.env`) **et** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
(`web/.env.local`), et la clé privée dans `VAPID_PRIVATE_KEY` (`api/.env` seulement).
La clé privée est un secret : jamais dans le code, `.env.example` ni la documentation.
Pour recevoir une vraie notification sur ton appareil :

1. Connecte-toi à l'app, une bannière propose d'« Activer » les notifications
   (ou active-les manuellement dans les réglages du site si tu l'as ignorée).
2. Accepte la demande d'autorisation du navigateur.
3. Fais-toi notifier — par exemple en publiant un document, un événement ou
   une annonce depuis un autre compte (secrétaire, admin…).

**Pour la production**, utilise une paire de clés différente de celle du local.
Si les clés changent, l'appli réabonne automatiquement chaque appareil à sa
prochaine ouverture.

### 1.5 Réinitialiser les données

```bash
cd api
npx prisma migrate reset   # supprime, recrée et reseed la base
```

---

## 2. Mise en production

### 2.1 Base de données

- Provisionnez une instance PostgreSQL managée (Neon, Supabase, RDS…).
- Renseignez `DATABASE_URL` dans les variables d'environnement de l'API.
- Déployez le schéma avec les migrations (jamais `migrate dev` en prod) :

  ```bash
  npx prisma migrate deploy
  ```

### 2.2 API NestJS

- Build : `npm run build` puis `npm run start:prod` (ou conteneurisez avec
  un `Dockerfile` Node standard, `node dist/main.js` comme commande).
- Variables d'environnement à définir : `DATABASE_URL`, `JWT_SECRET` (secret
  fort et unique), `JWT_EXPIRES_IN`, `CORS_ORIGIN` (domaine du front),
  `PORT`.
- **Stockage des fichiers** : `StorageService`
  (`api/src/common/storage/storage.service.ts`) écrit sur disque local tant
  que `S3_BUCKET` n'est pas défini, et sur un bucket S3 (AWS S3, Backblaze B2,
  Cloudflare R2, Supabase Storage…) dès qu'il l'est. En production, utilisez
  S3 : le disque d'un hébergeur comme Render est effacé à chaque redéploiement.
  Le bucket doit rester **privé** : l'API lit elle-même les fichiers. Les photos
  de profil et les pièces jointes d'annonces sont servies par `/files/avatars/…`
  et `/files/announcements/…` ; les reçus et documents ne sortent que par leurs
  routes protégées. Voir « Configurer le stockage S3 » plus bas.
- **Notifications** : renseignez les clés VAPID (API et `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
  côté web). Sur iPhone, le membre doit ajouter l'appli à l'écran d'accueil
  (iOS 16.4+) pour recevoir les notifications. Le son est `web/public/sounds/notification.mp3`
  (joué quand l'appli est ouverte ; appli fermée, le téléphone utilise son son système).
- **Sécurité** : HTTPS/TLS obligatoire (via un reverse proxy — Nginx,
  Caddy, ou la terminaison TLS de votre hébergeur), Argon2id déjà utilisé
  pour les mots de passe, `helmet` et rate limiting déjà actifs. Passez
  `JWT_SECRET` par un gestionnaire de secrets, jamais en clair dans le
  dépôt.
- **Sauvegardes** : planifiez des sauvegardes régulières de PostgreSQL et du
  bucket de stockage, avec tests de restauration périodiques.
- **Tâches planifiées** : les jobs (`api/src/jobs/jobs.service.ts`)
  utilisent `@nestjs/schedule` et tournent dans le process de l'API. Pour un
  déploiement multi-instances, déplacez-les vers un worker dédié (ou
  Redis/BullMQ comme suggéré au cahier des charges) afin d'éviter les
  exécutions concurrentes.
- **Render (plan gratuit)** : le service s'endort après 15 min d'inactivité,
  ce qui casse les tâches planifiées ci-dessus. Le workflow
  `.github/workflows/keep-api-alive.yml` ping `/api/health` toutes les 10
  minutes pour l'empêcher de dormir — **renseigne `RENDER_API_URL`** dans ce
  fichier une fois l'API déployée. Tourne sur l'infrastructure GitHub, sans
  dépendre d'une session ou d'un service tiers.

### 2.3 Application web (Next.js PWA)

- Build : `npm run build` puis `npm run start` (ou déployez sur Vercel /
  tout hébergeur Node).
- Variable d'environnement : `NEXT_PUBLIC_API_URL` → URL publique de l'API
  en production (HTTPS).
- Mettez à jour `next.config.js` → `images.remotePatterns` avec le domaine
  réel qui sert les fichiers (avatars, documents) en production.
- Vérifiez l'installation PWA sur Android (Chrome) et iOS (Safari) : icônes,
  manifeste (`/manifest.webmanifest`, généré automatiquement par
  `src/app/manifest.ts`) et Service Worker (`public/sw.js`) sont déjà en
  place.
- Servez le tout exclusivement en HTTPS (obligatoire pour Service Worker et
  Web Push).

### 2.4 Points à valider avec le bureau avant mise en production

(Repris du cahier des charges, §13 — à trancher avant le déploiement final)

- Compatibilité Web Push ciblée (Android/iOS) au moment du déploiement.
- Format definitif des bilans PDF/Excel.
- Règles de vote et anonymat des sondages.
- Permissions exactes du Président/Admin et du Pasteur/Encadreur.
- Politique de conservation des PV, reçus et journaux d'audit.

---

## 3. Comptes de test (après `npm run prisma:seed`, base locale)

| Profil | Identifiant | Mot de passe |
| --- | --- | --- |
| Président / Admin | `president` | `MimsAdmin#2026` |
| Trésorier | `tresorier` | `MimsTresor#2026` |
| Secrétaire | `secretaire` | `MimsSecret#2026` |
| Pasteur / Encadreur | `pasteur` | `MimsPasteur#2026` |
| Membre | `membre` | `MimsMembre#2026` *(écran de bienvenue à faire)* |

En production, les mêmes comptes se créent avec `SEED_ALLOW_REMOTE=1 npx ts-node prisma/seed.ts`
(dans `api/`) : uniquement si la base n'a aucun membre, rien n'est effacé, et chacun
doit changer son mot de passe à la première connexion.

---

## 4. Fonctionnalités clés couvertes

- Fiche membre complète, statut, onboarding, comptes utilisateurs (RBAC à
  cinq rôles : Membre, Secrétaire, Trésorier, Président/Admin,
  Pasteur/Encadreur).
- **Chaque membre peut modifier ses informations personnelles et changer sa
  photo de profil** depuis « Mon profil ».
- Cotisation mensuelle de 500 FCFA à régler le **2e dimanche du mois** ; un nouveau membre
  paie à partir du prochain 2e dimanche ; rappel le jeudi d'avant et le matin même
  (vérifiable avec `npm run check:cotisation` dans `api/`). Paiements (espèces, Mobile Money,
  virement), allocation aux échéances, paiements partiels/multi-mois, reçus
  PDF téléchargeables, contre-passation traçable (aucune suppression de
  paiement).
- Documents (règlement, PV) : dépôt, publication, notification automatique,
  intégrité SHA-256.
- Événements avec confirmation de présence, sondages avec résultats en
  direct, quiz notés.
- **Annonces** : réservées au Pasteur/Encadreur, au Président/Admin et à la
  Secrétaire, publication immédiate avec pièce jointe optionnelle (image ou
  tout autre fichier), visible par tous, notification automatique à toute la
  communauté.
- Notifications personnelles, centre de notifications, **et vraies
  notifications Web Push sur l'appareil** (même application fermée), avec
  son et bannière d'activation dans l'app.
- Journal d'audit append-only, chaîné par hash (`hash_prev` / `hash_current`).
- Tâches planifiées : échéances mensuelles, rappels amicaux, relances de
  dette, vœux d'anniversaire, rappels d'événements, clôture automatique des
  sondages.
  
  
  
  
  
  
### Configurer le stockage S3

Exemple avec Backblaze B2 (10 Go gratuits), mais tout service compatible S3 convient.

1. Créer un bucket **privé** (dans B2 : *Buckets → Create a Bucket*, « Files in Bucket » = **Private**). Noter son nom et son *Endpoint* (`s3.<région>.backblazeb2.com`).
2. Créer une clé d'application (*Application Keys → Add a New Application Key*), limitée à ce bucket, en lecture et écriture. Copier le `keyID` et l'`applicationKey` (affiché une seule fois).
3. Renseigner les variables (dans `api/.env` pour tester, puis dans l'environnement de l'hébergeur) :

```
S3_BUCKET=<nom du bucket>
S3_REGION=<région, ex. us-west-004>
S3_ENDPOINT=https://s3.<région>.backblazeb2.com
S3_ACCESS_KEY_ID=<keyID>
S3_SECRET_ACCESS_KEY=<applicationKey>
```

4. Vérifier avec `cd api && npm run storage:check` : la commande envoie un fichier de test puis le relit.

`S3_PUBLIC_URL_BASE` n'est plus utilisée : plus besoin de rendre le bucket public.

