import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mockJsonRoute } from '../../src/core/utils/network.util';
import { TAGS } from '../../src/core/constants';

// Validates route interception/mocking via Playwright's native page.route —
// no external service involved, so this never depends on network access.
test.describe('Network mocking', () => {
  test(
    `intercepts and mocks an API response ${TAGS.E2E}`,
    { tag: ['@network.mocking'] },
    async ({ page }) => {
      await mockJsonRoute(page, '**/api/mocked-endpoint', { mocked: true, value: 42 });

      await page.goto('about:blank');
      const result = await page.evaluate(async () => {
        const response = await fetch('https://example.com/api/mocked-endpoint');
        return response.json();
      });

      expect(result).toEqual({ mocked: true, value: 42 });
    },
  );
});
