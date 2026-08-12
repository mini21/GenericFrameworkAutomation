import { FullConfig } from '@playwright/test';
import { logger } from './logger/logger';
import { EnvironmentManager } from './config/environment-manager';
import { BrowserManager } from './browser/browser-manager';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  logger.info(`Global setup: starting run against env=${EnvironmentManager.environment}`, {
    baseUrl: EnvironmentManager.baseUrl,
    apiBaseUrl: EnvironmentManager.apiBaseUrl,
  });

  // Pre-flight sanity check, independent of Playwright's own per-test
  // browser fixtures — surfaces a missing-browser-dependency environment
  // early rather than as a confusing first-test failure. Non-fatal: a
  // browser-less environment running only the `api` project is valid.
  try {
    const browser = await BrowserManager.launch('chromium');
    await BrowserManager.close(browser);
    logger.info('Global setup: browser automation sanity check passed');
  } catch (error) {
    logger.warn('Global setup: browser sanity check failed (continuing anyway)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
