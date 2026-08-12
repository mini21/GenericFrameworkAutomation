import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Example page object for the-internet.herokuapp.com/secure — see
 * login.page.ts for context on why this target was chosen.
 */
export class SecurePage extends BasePage {
  private readonly logoutLink = 'a[href="/logout"]';

  constructor(page: Page) {
    super(page);
  }

  async isLoggedIn(): Promise<boolean> {
    return this.isVisible(this.logoutLink);
  }
}
