import { test, expect } from '../../../../src/core/fixtures/base.fixture';
import { TAGS } from '../../../../src/core/constants';
import { loadDataProfile } from '../../../../src/core/execution/data-profile';
import { getExecutionContext } from '../../../../src/core/execution/execution-context';
import { HrmsDataProfile } from '../../data/types';

const profile = loadDataProfile<HrmsDataProfile>(
  'hrms',
  getExecutionContext().dataProfile ?? 'qa-default',
);

test.describe('HRMS Login', () => {
  test(
    'employee logs in with valid credentials',
    { tag: ['@application.hrms', '@module.auth', TAGS.SMOKE, '@hrms.auth.login.valid'] },
    async ({ page, ui }) => {
      await page.goto('/login.html');
      await ui.fill('Username', profile.employee.username);
      await ui.fill('Password', profile.employee.password);
      await ui.click('Login');

      await page.waitForURL('**/dashboard.html');
      await expect(page.locator('#welcome-message')).toContainText(profile.employee.name);
    },
  );

  test(
    'employee login fails with invalid credentials',
    { tag: ['@application.hrms', '@module.auth', TAGS.REGRESSION, '@hrms.auth.login.invalid'] },
    async ({ page, ui }) => {
      await page.goto('/login.html');
      await ui.fill('Username', profile.employee.username);
      await ui.fill('Password', 'WrongPassword!');
      await ui.click('Login');

      await expect(page.locator('#error-message')).toContainText('Invalid username or password');
    },
  );
});
