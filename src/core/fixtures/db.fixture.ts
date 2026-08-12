import { test as base } from '@playwright/test';
import { DbClient, createDbClient } from '../db/db-client';

export const test = base.extend<object, { db: DbClient }>({
  db: [
    async ({}, use) => {
      const db = createDbClient();
      await db.connect();
      await use(db);
      await db.disconnect();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
