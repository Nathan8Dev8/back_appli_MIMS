import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  app.use(
    helmet({
      // Le front (Vercel) et l'API (Render) sont sur des domaines différents :
      // "same-origin" (valeur par défaut de helmet) empêche le navigateur de
      // charger les avatars/documents/reçus servis par l'API depuis le front —
      // d'où les images cassées malgré un fichier tout à fait valide.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Jeunes MIMS API en écoute sur http://localhost:${port}/api`);
}

bootstrap();
