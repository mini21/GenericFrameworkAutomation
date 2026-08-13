import { FullConfig } from '@playwright/test';
import { logger } from './logger/logger';
import { EnvironmentManager } from './config/environment-manager';
import { BrowserManager } from './browser/browser-manager';

const BROWSER_SANITY_CHECK_TIMEOUT_MS = 5_000;

export default async function globalSetup(_config: FullConfig): Promise<void> {
  logger.info(`Global setup: starting run against env=${EnvironmentManager.environment}`, {
    baseUrl: EnvironmentManager.baseUrl,
    apiBaseUrl: EnvironmentManager.apiBaseUrl,
  });

  // Pre-flight sanity check, independent of Playwright's own per-test
  // browser fixtures — surfaces a missing-browser-dependency environment
  // early rather than as a confusing first-test failure. Non-fatal: a
  // browser-less environment running only the `api` project is valid.
  //
  // Runs unconditionally rather than only for browser-using projects:
  // FullConfig.projects always lists every project configured in
  // playwright.config.ts regardless of --project CLI filtering (verified
  // empirically), so there's no reliable signal here to skip it for an
  // api-only invocation. The bounded timeout below is what actually
  // matters — without it, a hung launch would stall the entire run instead
  // of just costing this check its ~1s.
  try {
    const browser = await Promise.race([
      BrowserManager.launch('chromium'),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out after ${BROWSER_SANITY_CHECK_TIMEOUT_MS}ms`)),
          BROWSER_SANITY_CHECK_TIMEOUT_MS,
        ),
      ),
    ]);
    await BrowserManager.close(browser);
    logger.info('Global setup: browser automation sanity check passed');
  } catch (error) {
    logger.warn('Global setup: browser sanity check failed (continuing anyway)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
