import { test as base } from '@playwright/test';
import { DbClient, createDbClient } from '../db/db-client';

// Test-scoped, not worker-scoped: InMemoryDbClient has no expensive
// connection to amortize (unlike a real DB pool), so there's no
// performance reason to share one across tests in a worker — and sharing
// one meant tests in the same worker could see each other's inserted rows
// unless every test remembered to call db.clear() first. A fresh client
// per test gives the isolation the docs already promised.
export const test = base.extend<{ db: DbClient }>({
  db: async ({}, use) => {
    const db = createDbClient();
    await db.connect();
    await use(db);
    await db.disconnect();
  },
});

export { expect } from '@playwright/test';
