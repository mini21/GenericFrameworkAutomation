import { mergeTests } from '@playwright/test';
import { test as loggerTest } from './logger.fixture';
import { test as apiTest } from './api.fixture';
import { test as dbTest } from './db.fixture';

// Composition point for the framework's fixtures — specs always import this
// single `test` rather than any individual fixture module. Future fixture
// modules (ui, auth) merge in here as those layers land.
export const test = mergeTests(loggerTest, apiTest, dbTest);
export { expect } from '@playwright/test';
