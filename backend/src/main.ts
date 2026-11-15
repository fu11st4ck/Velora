import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { configureApp, createAdapter, jsonLogger } from './app.factory';
import { AppModule } from './app.module';
import { loadConfig } from './common/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(); // fails fast on a bad environment
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(config.TRUST_PROXY === 'true'), {
    logger: jsonLogger(config),
  });
  await configureApp(app);
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
