import { logger } from './logger/logger';

export default async function globalTeardown(): Promise<void> {
  logger.info('Global teardown: run complete');
}
