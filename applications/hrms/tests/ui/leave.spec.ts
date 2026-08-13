import * as crypto from 'crypto';
import { test, expect } from '../../../../src/core/fixtures/base.fixture';
import { TAGS } from '../../../../src/core/constants';
import { loadDataProfile } from '../../../../src/core/execution/data-profile';
import { getExecutionContext } from '../../../../src/core/execution/execution-context';
import { loginAsHrmsUser, dayOffsetForProject } from '../../fixtures/hrms-auth';
import { HrmsDataProfile } from '../../data/types';

const profile = loadDataProfile<HrmsDataProfile>(
  'hrms',
  getExecutionContext().dataProfile ?? 'qa-default',
);

// Reason strings are given a short unique suffix so a `getByText`/`hasText`
// assertion never collides with another execution of the same test — e.g.
// the same file running under both chromium and firefox in one session
// hits the same shared in-memory HRMS backend, so a hardcoded literal
// reason would otherwise match rows left behind by the other browser's run.
function uniqueReason(base: string): string {
  return `${base} ${crypto.randomUUID().slice(0, 8)}`;
}

// Same reasoning applies to dates: the overlap-detection business logic
// would otherwise see the *other* browser project's still-pending/approved
// request for the identical date range as a genuine conflict.
function dateOnDay(year: number, month: number, day: number, projectName: string): string {
  const d = day + dayOffsetForProject(projectName);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Serial: every test in this file shares employee1's leave-request state
// on the shared in-memory HRMS backend. Each test also cleans up after
// itself (cancels what it created), so no test leaves residual pending
// state for the next one — serial mode + self-cleanup together make this
// file fully deterministic regardless of worker count.
test.describe.configure({ mode: 'serial' });

test.describe('HRMS Leave', () => {
  test.beforeEach(async ({ page, ui }) => {
    await loginAsHrmsUser(page, ui, profile.employee);
  });

  test(
    'employee can apply for leave',
    { tag: ['@application.hrms', '@module.leave', TAGS.SMOKE, '@hrms.leave.apply.valid'] },
    async ({ page, ui }, testInfo) => {
      const reason = uniqueReason('Family trip');
      const project = testInfo.project.name;

      await page.goto('/apply-leave.html');
      await ui.fill('Start Date', dateOnDay(2026, 9, 1, project));
      await ui.fill('End Date', dateOnDay(2026, 9, 3, project));
      await ui.fill('Reason', reason);
      await ui.click('Submit Application');

      await expect(page.locator('#result-message')).toContainText('submitted successfully');

      await page.goto('/leave-history.html');
      await expect(page.getByText(reason)).toBeVisible();

      await ui.click('Cancel');
      await expect(page.locator('tr', { hasText: reason })).toContainText('cancelled');
    },
  );

  test(
    'employee cannot apply for overlapping leave',
    { tag: ['@application.hrms', '@module.leave', TAGS.REGRESSION, '@hrms.leave.apply.overlap'] },
    async ({ page, ui }, testInfo) => {
      const firstReason = uniqueReason('First booking');
      const overlapReason = uniqueReason('Overlapping booking');
      const project = testInfo.project.name;

      await page.goto('/apply-leave.html');
      await ui.fill('Start Date', dateOnDay(2026, 10, 1, project));
      await ui.fill('End Date', dateOnDay(2026, 10, 3, project));
      await ui.fill('Reason', firstReason);
      await ui.click('Submit Application');
      await expect(page.locator('#result-message')).toContainText('submitted successfully');

      await page.goto('/apply-leave.html');
      await ui.fill('Start Date', dateOnDay(2026, 10, 2, project));
      await ui.fill('End Date', dateOnDay(2026, 10, 5, project));
      await ui.fill('Reason', overlapReason);
      await ui.click('Submit Application');
      await expect(page.locator('#result-message')).toContainText('overlap');

      await page.goto('/leave-history.html');
      await expect(page.locator('tr', { hasText: firstReason })).toBeVisible();
      await ui.click('Cancel');
    },
  );

  test(
    'employee can cancel a pending leave request',
    { tag: ['@application.hrms', '@module.leave', TAGS.REGRESSION, '@hrms.leave.cancel'] },
    async ({ page, ui }, testInfo) => {
      const reason = uniqueReason('To be cancelled');
      const project = testInfo.project.name;

      await page.goto('/apply-leave.html');
      await ui.fill('Start Date', dateOnDay(2026, 11, 1, project));
      await ui.fill('End Date', dateOnDay(2026, 11, 2, project));
      await ui.fill('Reason', reason);
      await ui.click('Submit Application');

      await page.goto('/leave-history.html');
      await ui.click('Cancel');

      await expect(page.locator('tr', { hasText: reason })).toContainText('cancelled');
    },
  );

  test(
    'employee can view leave history',
    { tag: ['@application.hrms', '@module.leave', TAGS.SANITY, '@hrms.leave.history'] },
    async ({ page, ui }, testInfo) => {
      const reason = uniqueReason('History check');
      const project = testInfo.project.name;

      await page.goto('/apply-leave.html');
      await ui.fill('Start Date', dateOnDay(2026, 12, 1, project));
      await ui.fill('End Date', dateOnDay(2026, 12, 2, project));
      await ui.fill('Reason', reason);
      await ui.click('Submit Application');

      await page.goto('/leave-history.html');
      await expect(page.getByText(reason)).toBeVisible();

      await ui.click('Cancel');
    },
  );
});
