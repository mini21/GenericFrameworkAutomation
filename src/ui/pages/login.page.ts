import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Example page object against the-internet.herokuapp.com/login — a public
 * practice site used purely to validate the UI fixture/page-object wiring.
 * Replace with real page objects once a target application is chosen.
 */
export class LoginPage extends BasePage {
  private readonly usernameInput = '#username';
  private readonly passwordInput = '#password';
  private readonly submitButton = 'button[type="submit"]';
  private readonly flashMessage = '#flash';

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto('/login');
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.fill(this.usernameInput, username);
    await this.page.fill(this.passwordInput, password);
    await this.page.click(this.submitButton);
  }

  async getFlashMessage(): Promise<string> {
    return (await this.page.locator(this.flashMessage).textContent())?.trim() ?? '';
  }
}
