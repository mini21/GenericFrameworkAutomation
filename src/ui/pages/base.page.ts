import { Page } from '@playwright/test';
import { logger } from '../../core/logger/logger';
import { TIMEOUTS } from '../../core/constants';

export abstract class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(path = ''): Promise<void> {
    logger.info(`Navigating to: ${path || '/'}`);
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('load', { timeout: TIMEOUTS.PAGE_LOAD });
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.page.locator(selector).isVisible();
  }

  async reload(): Promise<void> {
    logger.info('Reloading page');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }
}
