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

// See leave.spec.ts for why: unique per execution, so re-running this file
// under a different browser project against the same shared HRMS backend
// never produces a duplicate-text ambiguity or a spurious overlap conflict.
function uniqueReason(base: string): string {
  return `${base} ${crypto.randomUUID().slice(0, 8)}`;
}

function dateOnDay(year: number, month: number, day: number, projectName: string): string {
  const d = day + dayOffsetForProject(projectName);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Serial for the same reason as leave.spec.ts: the manager's approvals
// view aggregates pending requests across every employee, so two tests
// leaving requests pending at once would make "Approve"/"Reject" ambiguous.
test.describe.configure({ mode: 'serial' });

test.describe('HRMS Approval', () => {
  test(
    'manager can approve a pending leave request',
    { tag: ['@application.hrms', '@module.approval', TAGS.SMOKE, '@hrms.approval.approve'] },
    async ({ page, ui, request }, testInfo) => {
      const reason = uniqueReason('Approval test request');
      const project = testInfo.project.name;

      // Setup via API as employee2 — Playwright's native `request` fixture
      // is test-scoped and isolated from `page`'s browser context, so this
      // session never leaks into the manager UI session used below.
      const loginRes = await request.post('/api/login', {
        data: { username: profile.employeeTwo.username, password: profile.employeeTwo.password },
      });
      expect(loginRes.ok()).toBe(true);
      const applyRes = await request.post('/api/leave/apply', {
        data: {
          startDate: dateOnDay(2027, 1, 1, project),
          endDate: dateOnDay(2027, 1, 2, project),
          reason,
        },
      });
      expect(applyRes.status()).toBe(201);

      await loginAsHrmsUser(page, ui, profile.manager);
      await page.goto('/approvals.html');
      await expect(page.getByText(reason)).toBeVisible();

      await ui.click('Approve');

      await expect(page.getByText(reason)).not.toBeVisible();
    },
  );

  test(
    'manager can reject a pending leave request',
    { tag: ['@application.hrms', '@module.approval', TAGS.REGRESSION, '@hrms.approval.reject'] },
    async ({ page, ui, request }, testInfo) => {
      const reason = uniqueReason('Reject test request');
      const project = testInfo.project.name;

      const loginRes = await request.post('/api/login', {
        data: { username: profile.employeeTwo.username, password: profile.employeeTwo.password },
      });
      expect(loginRes.ok()).toBe(true);
      const applyRes = await request.post('/api/leave/apply', {
        data: {
          startDate: dateOnDay(2027, 2, 1, project),
          endDate: dateOnDay(2027, 2, 2, project),
          reason,
        },
      });
      expect(applyRes.status()).toBe(201);

      await loginAsHrmsUser(page, ui, profile.manager);
      await page.goto('/approvals.html');
      await expect(page.getByText(reason)).toBeVisible();

      await ui.click('Reject');

      await expect(page.getByText(reason)).not.toBeVisible();
    },
  );
});
