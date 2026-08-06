import { mergeTests } from '@playwright/test';
import { test as loggerTest } from './logger.fixture';

// Composition point for the framework's fixtures. Future fixture modules
// (api, auth, db) merge in here so specs always import a single `test`.
export const test = mergeTests(loggerTest);
export { expect } from '@playwright/test';
