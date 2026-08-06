import { test as base } from '@playwright/test';
import { logger } from '../logger/logger';

export const test = base.extend<{ autoLogger: void }>({
  autoLogger: [
    async ({}, use, testInfo) => {
      logger.info(`Starting test: ${testInfo.title}`);
      await use();
      logger.info(`Finished test: ${testInfo.title}`, { status: testInfo.status });
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
