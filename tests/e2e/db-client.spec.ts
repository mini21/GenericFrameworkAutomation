import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';

// Validates the db fixture (in-memory example DbClient) used for test
// data setup/verification/cleanup.
test.describe('DB client', () => {
  test(`inserts and reads back a row ${TAGS.SMOKE}`, async ({ db }) => {
    await db.insert('users', { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' });

    const row = await db.findOne('users', (r) => r.email === 'ada@example.com');

    expect(row?.name).toBe('Ada Lovelace');
  });

  test(`clears table data ${TAGS.REGRESSION}`, async ({ db }) => {
    await db.insert('users', { id: 2, name: 'Alan Turing', email: 'alan@example.com' });
    await db.clear('users');

    const rows = await db.find('users');
    expect(rows).toHaveLength(0);
  });
});
