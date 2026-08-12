import { FullConfig } from '@playwright/test';
import { logger } from './logger/logger';
import { EnvironmentManager } from './config/environment-manager';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  logger.info(`Global setup: starting run against env=${EnvironmentManager.environment}`, {
    baseUrl: EnvironmentManager.baseUrl,
    apiBaseUrl: EnvironmentManager.apiBaseUrl,
  });
}
