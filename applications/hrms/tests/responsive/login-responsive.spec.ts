import { test, expect } from '../../../../src/core/fixtures/base.fixture';
import { TAGS } from '../../../../src/core/constants';

/**
 * Proves the "responsive" test-type extension point end to end: a real
 * assertion (every login control stays resolvable and usable at a given
 * viewport, not just "the page loaded"), using the SAME `page`/`ui`
 * fixtures and LocatorResolver every other HRMS test already uses — no
 * new locator engine, no new fixture, just a per-test `test.use({
 * viewport })` override, which is Playwright's own native mechanism.
 */
const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`HRMS Login responsive (${name}) ${TAGS.SMOKE}`, () => {
    test.use({ viewport });

    test(`login form controls remain resolvable and usable at ${name} viewport`, async ({
      page,
      ui,
    }) => {
      await page.goto('/login.html');

      await expect(page.getByRole('heading', { name: 'Employee Leave Management' })).toBeVisible();

      // Resolves through the same LocatorResolver as every other test —
      // this is what actually proves the controls are still usable
      // (visible + interactable), not merely present in the DOM.
      await ui.fill('Username', 'employee1');
      await ui.fill('Password', 'wrong-password-on-purpose');
      await ui.click('Login');

      await expect(page.getByRole('alert')).toContainText('Invalid username or password');
    });
  });
}
