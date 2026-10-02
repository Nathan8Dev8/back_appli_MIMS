import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface StoredFile {
  storageKey: string;
  sha256: string;
  /** URL à partir de laquelle le fichier est directement accessible. */
  url: string;
}

/**
 * Adaptateur de stockage de fichiers, à deux implémentations choisies
 * automatiquement selon la configuration :
 *
 * - Disque local (par défaut, tant que S3_BUCKET n'est pas défini) : écrit
 *   dans STORAGE_ROOT. Pratique en
 *   développement, mais ÉPHÉMÈRE sur la plupart des hébergeurs (Render,
 *   Railway…) : tout disparaît au redéploiement ou redémarrage.
 * - S3 (dès que S3_BUCKET est défini) : compatible AWS S3, Cloudflare R2,
 *   Backblaze B2, Supabase Storage, MinIO… via S3_ENDPOINT. C'est
 *   l'implémentation à utiliser en production. Le bucket peut rester privé :
 *   c'est l'API qui lit les fichiers (voir FilesController).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly localRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), 'storage');
  private readonly bucket = process.env.S3_BUCKET;
  private readonly s3: S3Client | null;

  constructor() {
    if (this.bucket) {
      this.s3 = new S3Client({
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        // Les versions récentes du SDK ajoutent des sommes de contrôle que plusieurs services
        // compatibles S3 (Backblaze B2, Cloudflare R2…) ne gèrent pas toujours : on ne les envoie que si S3 l'exige.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials:
          process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
      this.logger.log(`Stockage S3 actif (bucket "${this.bucket}").`);
    } else {
      this.s3 = null;
      this.logger.warn(
        'S3_BUCKET absent : stockage sur disque local (ÉPHÉMÈRE en production — voir README « Mise en production »).',
      );
    }
  }

  async put(key: string, buffer: Buffer, contentType?: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    if (this.s3 && this.bucket) {
      try {
        await this.s3.send(
          new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
        );
      } catch (err: any) {
        // Le détail technique va dans les logs ; l'utilisateur reçoit un message compréhensible au lieu d'une erreur 500.
        this.logger.error(`Envoi vers le stockage refusé (${err?.name ?? 'erreur'}) : ${err?.message ?? err}`);
        throw new ServiceUnavailableException(
          "Le fichier n'a pas pu être enregistré : le stockage des fichiers est indisponible ou mal configuré. Préviens l'administrateur.",
          { cause: err },
        );
      }
      return { storageKey: key, sha256, url: this.publicUrl(key) };
    }

    const fullPath = join(this.localRoot, key);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, buffer);
    return { storageKey: key, sha256, url: `/files/${key}` };
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3 && this.bucket) {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const stream = res.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    return readFile(join(this.localRoot, key));
  }

  async exists(key: string): Promise<boolean> {
    if (this.s3 && this.bucket) {
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    return existsSync(join(this.localRoot, key));
  }

  /**
   * Adresse d'un fichier, relative à l'API : /files est servi par FilesController,
   * que le stockage soit local ou S3. Le bucket peut donc rester privé.
   */
  publicUrl(key: string): string {
    return `/files/${key}`;
  }
}
