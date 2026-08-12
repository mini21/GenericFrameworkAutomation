import { test as base } from '@playwright/test';
import { LoginPage } from '../../ui/pages/login.page';
import { SecurePage } from '../../ui/pages/secure.page';
import { UploadPage } from '../../ui/pages/upload.page';
import { DownloadPage } from '../../ui/pages/download.page';

export const test = base.extend<{
  loginPage: LoginPage;
  securePage: SecurePage;
  uploadPage: UploadPage;
  downloadPage: DownloadPage;
}>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  securePage: async ({ page }, use) => {
    await use(new SecurePage(page));
  },

  uploadPage: async ({ page }, use) => {
    await use(new UploadPage(page));
  },

  downloadPage: async ({ page }, use) => {
    await use(new DownloadPage(page));
  },
});

export { expect } from '@playwright/test';
