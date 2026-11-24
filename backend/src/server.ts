import express, { Express } from 'express';
import cors from 'cors';
import { env } from './config';
import { apiRouter } from './routes';
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
} from './common/middleware';
import { logger } from './common/utils/logger';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info('Server listening', { port: env.PORT, env: env.NODE_ENV });
});

function shutdown(signal: string): void {
  logger.info('Shutting down', { signal });
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
