import { test as base, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { LoginPage } from '../../ui/pages/login.page';
import { EnvironmentManager } from '../config/environment-manager';
import { logger } from '../logger/logger';

const AUTH_DIR = path.resolve(process.cwd(), '.auth');

// Fall back to the-internet.herokuapp.com's own published demo credentials
// (printed on its /login page for anyone to use — not a real secret) only
// when AUTH_USERNAME/AUTH_PASSWORD aren't configured. Once a real target
// with real credentials is chosen, set those env vars and this fixture
// uses them automatically — no code change needed.
const DEMO_USERNAME = 'tomsmith';
const DEMO_PASSWORD = 'SuperSecretPassword!';
const USERNAME = EnvironmentManager.authUsername ?? DEMO_USERNAME;
const PASSWORD = EnvironmentManager.authPassword ?? DEMO_PASSWORD;

export const test = base.extend<{ authenticatedPage: Page }, { storageStatePath: string }>({
  storageStatePath: [
    async ({ browser }, use, workerInfo) => {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const statePath = path.join(AUTH_DIR, `worker-${workerInfo.workerIndex}.json`);

      const context = await browser.newContext({ baseURL: EnvironmentManager.baseUrl });
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.open();
      await loginPage.login(USERNAME, PASSWORD);
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
