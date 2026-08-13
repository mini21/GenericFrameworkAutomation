import { Page, Download } from '@playwright/test';
import { BasePage } from './base.page';

/** Example page object for the-internet.herokuapp.com/download — see login.page.ts for context. */
export class DownloadPage extends BasePage {
  private readonly firstDownloadLink = 'a[href^="download/"]';

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto('/download');
  }

  async downloadFirstFile(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.locator(this.firstDownloadLink).first().click(),
    ]);
    return download;
  }
}
