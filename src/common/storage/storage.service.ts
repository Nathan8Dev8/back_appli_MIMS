import { Injectable, Logger } from '@nestjs/common';
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
 *   dans STORAGE_ROOT, servi par ServeStaticModule sur /files. Pratique en
 *   développement, mais ÉPHÉMÈRE sur la plupart des hébergeurs (Render,
 *   Railway…) : tout disparaît au redéploiement ou redémarrage.
 * - S3 (dès que S3_BUCKET est défini) : compatible AWS S3, Cloudflare R2,
 *   Backblaze B2, Supabase Storage, MinIO… via S3_ENDPOINT. C'est
 *   l'implémentation à utiliser en production — voir README « Mise en
 *   production » pour la configuration complète des variables S3_*.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly localRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), 'storage');
  private readonly bucket = process.env.S3_BUCKET;
  private readonly publicUrlBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/+$/, '') || null;
  private readonly s3: S3Client | null;

  constructor() {
    if (this.bucket) {
      this.s3 = new S3Client({
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
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
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
      );
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

  /** URL publique d'un fichier stocké en S3 (bucket en lecture publique, ou domaine CDN dédié via S3_PUBLIC_URL_BASE). */
  publicUrl(key: string): string {
    if (this.publicUrlBase) return `${this.publicUrlBase}/${key}`;
    if (process.env.S3_ENDPOINT) return `${process.env.S3_ENDPOINT.replace(/\/+$/, '')}/${this.bucket}/${key}`;
    return `https://${this.bucket}.s3.${process.env.S3_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;
  }
}
