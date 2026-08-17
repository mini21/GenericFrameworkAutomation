import { Page } from '@playwright/test';
import { UiActions } from '../../../src/core/locator/ui-actions';
import { HrmsCredential } from '../data/types';

/**
 * Application-specific helper, composing the generic `page`/`ui` fixtures
 * without modifying either — lives entirely under the application
 * boundary, proving GAP core needs no changes for a new application.
 */
export async function loginAsHrmsUser(
  page: Page,
  ui: UiActions,
  credential: HrmsCredential,
): Promise<void> {
  await page.goto('/login.html');
  await ui.fill('Username', credential.username);
  await ui.fill('Password', credential.password);
  await ui.click('Login');
  await page.waitForURL('**/dashboard.html');
}

// Deterministic, per-browser-project offset — not randomness. The same
// spec runs against the same shared in-memory HRMS backend under every
// browser project in a combined run, so a hardcoded date range would
// otherwise collide (the second browser's "apply" hits the first
// browser's still-present pending/approved request for those exact, or
// even just adjacent, dates — the overlap check treats touching ranges as
// overlapping too). Each project gets its own block of days, wide enough
// that no test's date range (up to a few days) can reach into the next
// project's block, so cross-project runs never overlap.
const PROJECT_BLOCK_INDEX: Record<string, number> = { chromium: 0, firefox: 1, webkit: 2, api: 3 };
const BLOCK_SIZE_DAYS = 5;

export function dayOffsetForProject(projectName: string): number {
  return (PROJECT_BLOCK_INDEX[projectName] ?? 0) * BLOCK_SIZE_DAYS;
}
