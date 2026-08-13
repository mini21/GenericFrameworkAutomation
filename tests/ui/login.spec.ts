import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';
import { captureScreenshot } from '../../src/core/utils/screenshot.util';

// Validates the ui fixture + page object wiring against a public practice
// site. Replace with specs for the real target UI once one is chosen.
test.describe('Login', () => {
  test(`logs in with valid credentials ${TAGS.SMOKE}`, async ({ loginPage, securePage, page }) => {
    await loginPage.open();
    await loginPage.login('tomsmith', 'SuperSecretPassword!');

    expect(await securePage.isLoggedIn()).toBe(true);
    expect(await loginPage.getFlashMessage()).toContain('You logged into a secure area');

    // On-demand capture (distinct from the automatic failure-only
    // screenshot config) — useful for visually confirming a passing state.
    await captureScreenshot(page, 'secure-area-after-login');
  });

  test(`rejects invalid credentials ${TAGS.REGRESSION}`, async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.login('invalid-user', 'invalid-password');

    expect(await loginPage.getFlashMessage()).toContain('Your username is invalid');
  });
});
