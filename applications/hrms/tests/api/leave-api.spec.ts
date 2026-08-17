import { test, expect } from '../../../../src/core/fixtures/base.fixture';
import { TAGS } from '../../../../src/core/constants';
import { loadDataProfile } from '../../../../src/core/execution/data-profile';
import { getExecutionContext } from '../../../../src/core/execution/execution-context';
import { HrmsApiClient } from '../../api/hrms-api-client';
import { HrmsDataProfile } from '../../data/types';

const profile = loadDataProfile<HrmsDataProfile>(
  'hrms',
  getExecutionContext().dataProfile ?? 'qa-default',
);

test.describe('HRMS Leave API', () => {
  test(
    'employee applies for leave via the API',
    { tag: ['@application.hrms', '@module.leave', TAGS.SMOKE, '@hrms.leave.api.apply'] },
    async ({ api }) => {
      const hrms = new HrmsApiClient(api);

      const loginRes = await hrms.login(
        profile.employeeThree.username,
        profile.employeeThree.password,
      );
      expect(loginRes.ok()).toBe(true);

      const applyRes = await hrms.applyLeave({
        startDate: '2027-03-01',
        endDate: '2027-03-02',
        reason: 'API test',
      });
      expect(applyRes.status()).toBe(201);
      const { request } = await applyRes.json();

      const listRes = await hrms.listLeave();
      const { requests } = (await listRes.json()) as { requests: { id: string }[] };
      expect(requests.some((r) => r.id === request.id)).toBe(true);

      const cancelRes = await hrms.cancelLeave(request.id);
      expect(cancelRes.ok()).toBe(true);
    },
  );
});
