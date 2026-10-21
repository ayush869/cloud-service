import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { appConfig, AppConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(appConfig.KEY);
  await app.listen(config.port, config.host);
  Logger.log(`API listening on ${config.host}:${config.port} (public URL ${config.publicBaseUrl})`, 'Bootstrap');
  if (config.swaggerEnabled) Logger.log(`Swagger UI at ${config.publicBaseUrl}/docs`, 'Bootstrap');
}

void bootstrap();
