import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/** Example page object for the-internet.herokuapp.com/upload — see login.page.ts for context. */
export class UploadPage extends BasePage {
  private readonly fileInput = '#file-upload';
  private readonly submitButton = '#file-submit';
  private readonly uploadedFileName = '#uploaded-files';

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto('/upload');
  }

  async uploadFile(filePath: string): Promise<void> {
    await this.page.setInputFiles(this.fileInput, filePath);
    await this.page.click(this.submitButton);
  }

  async getUploadedFileName(): Promise<string> {
    return (await this.page.locator(this.uploadedFileName).textContent())?.trim() ?? '';
  }
}
