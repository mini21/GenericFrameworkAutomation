import { test as base } from '@playwright/test';
import { logger } from '../logger/logger';

export const test = base.extend<{ autoLogger: void }>({
  autoLogger: [
    async ({}, use, testInfo) => {
      logger.info(`Starting test: ${testInfo.title}`);
      await use();

      if (testInfo.status === 'interrupted') {
        // Worker crash, Ctrl-C, or --max-failures cutoff — the test never
        // ran to a failing assertion, so this isn't a real failure.
        logger.warn(`Test interrupted: ${testInfo.title}`, { status: testInfo.status });
      } else if (testInfo.status !== testInfo.expectedStatus) {
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
