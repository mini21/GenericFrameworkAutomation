import { mergeTests } from '@playwright/test';
import { test as loggerTest } from './logger.fixture';
import { test as apiTest } from './api.fixture';
import { test as dbTest } from './db.fixture';
import { test as uiTest } from './ui.fixture';
import { test as authTest } from './auth.fixture';
import { test as locatorTest } from './locator.fixture';
import { test as testIsolationTest } from './test-isolation.fixture';

// Composition point for the framework's fixtures — specs always import this
// single `test` rather than any individual fixture module.
export const test = mergeTests(
  loggerTest,
  apiTest,
  dbTest,
  uiTest,
  authTest,
  locatorTest,
  testIsolationTest,
);
export { expect } from '@playwright/test';
