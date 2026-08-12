import { test as base } from '@playwright/test';
import { logger } from '../logger/logger';

export const test = base.extend<{ autoLogger: void }>({
  autoLogger: [
    async ({}, use, testInfo) => {
      logger.info(`Starting test: ${testInfo.title}`);
      await use();

      if (testInfo.status !== testInfo.expectedStatus) {
        logger.error(`Test failed: ${testInfo.title}`, {
          status: testInfo.status,
          error: testInfo.error?.message,
        });
      } else {
        logger.info(`Finished test: ${testInfo.title}`, { status: testInfo.status });
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
