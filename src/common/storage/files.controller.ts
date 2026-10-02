import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { extname } from 'path';
import { StorageService } from './storage.service';

/**
 * Sert les photos de profil et les pièces jointes des annonces, que le
 * navigateur charge par simple adresse (<img src>) sans pouvoir envoyer de jeton.
 * Le bucket S3 reste privé : c'est l'API qui va chercher le fichier.
 *
 * Seuls ces deux dossiers sont exposés. Les reçus et les documents, eux, ne
 * sortent que par leurs routes protégées.
 */
const PUBLIC_FOLDERS = ['avatars/', 'announcements/'];

const INLINE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

// Pas de limiteur de débit ici : une page de membres charge des dizaines de photos d'un coup.
@SkipThrottle()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Get('*')
  async serve(@Req() req: Request, @Res() res: Response) {
    let key: string;
    try {
      key = decodeURIComponent((req.params as Record<string, string>)[0] ?? '');
    } catch {
      throw new NotFoundException();
    }
    const unsafe = !key || key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('\0');
    if (unsafe || !PUBLIC_FOLDERS.some((folder) => key.startsWith(folder))) throw new NotFoundException();

    let buffer: Buffer;
    try {
      buffer = await this.storage.get(key);
    } catch {
      throw new NotFoundException();
    }

    const type = INLINE_TYPES[extname(key).toLowerCase()];
    res.set({
      'Content-Type': type ?? 'application/octet-stream',
      // Tout ce qui n'est pas une image ou un PDF est téléchargé, jamais exécuté dans le navigateur (un .html envoyé en pièce jointe, par exemple).
      ...(type ? {} : { 'Content-Disposition': 'attachment' }),
      // Les noms contiennent un identifiant unique : un fichier ne change jamais sous la même adresse.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.send(buffer);
  }
}
