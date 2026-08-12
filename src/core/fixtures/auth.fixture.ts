import { test as base, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { LoginPage } from '../../ui/pages/login.page';
import { EnvironmentManager } from '../config/environment-manager';
import { logger } from '../logger/logger';

const AUTH_DIR = path.resolve(process.cwd(), '.auth');
const VALID_USERNAME = 'tomsmith';
const VALID_PASSWORD = 'SuperSecretPassword!';

export const test = base.extend<
  { authenticatedPage: Page },
  { storageStatePath: string }
>({
  storageStatePath: [
    async ({ browser }, use, workerInfo) => {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const statePath = path.join(AUTH_DIR, `worker-${workerInfo.workerIndex}.json`);

      const context = await browser.newContext({ baseURL: EnvironmentManager.baseUrl });
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.open();
      await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
      await page.waitForURL('**/secure');
      await context.storageState({ path: statePath });
      await context.close();

      logger.info('Cached authenticated session for worker', {
        workerIndex: workerInfo.workerIndex,
      });
      await use(statePath);
    },
    { scope: 'worker' },
  ],

  authenticatedPage: async ({ browser, storageStatePath }, use) => {
    const context = await browser.newContext({
      baseURL: EnvironmentManager.baseUrl,
      storageState: storageStatePath,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
