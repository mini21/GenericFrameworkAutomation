import {
  chromium,
  firefox,
  webkit,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
} from 'playwright';
import { logger } from '../logger/logger';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface BrowserLaunchOptions {
  headless?: boolean;
  slowMo?: number;
}

const BROWSER_TYPES: Record<BrowserName, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

/**
 * Launches and manages Playwright browsers outside the standard per-test
 * fixture lifecycle — e.g. in global setup/teardown scripts or scenarios
 * that need an independent browser instance alongside the one Playwright's
 * built-in `page` fixture already provides inside a test.
 */
export class BrowserManager {
  static async launch(
    browserName: BrowserName = 'chromium',
    options: BrowserLaunchOptions = {},
  ): Promise<Browser> {
    const headless = options.headless ?? true;
    logger.info(`Launching browser: ${browserName}`, { headless });
    return BROWSER_TYPES[browserName].launch({
      headless,
      slowMo: options.slowMo,
    });
  }

  static async newContext(
    browser: Browser,
    options: BrowserContextOptions = {},
  ): Promise<BrowserContext> {
    logger.debug('Creating new browser context');
    return browser.newContext(options);
  }

  static async close(browser: Browser): Promise<void> {
    logger.info('Closing browser');
    await browser.close();
  }
}
