import { test, expect } from '../../src/core/fixtures/base.fixture';
import { SecurePage } from '../../src/ui/pages/secure.page';
import { TAGS } from '../../src/core/constants';

// Validates the worker-scoped auth fixture: login happens once per worker
// and the cached session is reused here.
test.describe('Secure area (authenticated)', () => {
  test(
    `shows secure area content ${TAGS.E2E}`,
    { tag: ['@auth.secure-area'] },
    async ({ authenticatedPage }) => {
      const securePage = new SecurePage(authenticatedPage);
      await securePage.goto('/secure');

      expect(await securePage.isLoggedIn()).toBe(true);
    },
  );
});
