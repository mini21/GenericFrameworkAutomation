import { AddressInfo } from 'net';
import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { TAGS, TEST_ISOLATION_HEADER } from '../../../../src/core/constants';
import { ApiClient } from '../../../../src/core/http/api-client';
import { createApp } from '../../server/app';

// A dedicated, isolated instance of the HRMS reference server — not the
// shared dev instance on :4100 — so this spec never depends on (or
// disturbs) whatever the rest of the suite is doing to that server.
let baseURL: string;
let close: () => Promise<void>;

test.beforeAll(async () => {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://localhost:${port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

test.afterAll(async () => {
  await close();
});

async function actor(): Promise<{ api: ApiClient; dispose: () => Promise<void> }> {
  const context: APIRequestContext = await pwRequest.newContext({ baseURL });
  return {
    api: new ApiClient(context),
    dispose: () => context.dispose(),
  };
}

async function loginAndApply(
  isolationToken: string | undefined,
  username: string,
  password: string,
  body: { startDate: string; endDate: string; reason: string },
): Promise<{ status: number; dispose: () => Promise<void> }> {
  const { api, dispose } = await actor();
  const headers = isolationToken ? { [TEST_ISOLATION_HEADER]: isolationToken } : undefined;
  await api.post('/api/login', { data: { username, password }, headers });
  const applyRes = await api.post('/api/leave/apply', { data: body, headers });
  return { status: applyRes.status(), dispose };
}

test.describe(`HRMS reference server — test-run data isolation ${TAGS.SMOKE}`, () => {
  test('two different isolation tokens never collide on the same employee + same dates (root cause of the reported suite failures)', async () => {
    const body = { startDate: '2031-01-01', endDate: '2031-01-02', reason: 'isolation check' };

    const first = await loginAndApply('token-A', 'employee1', 'Employee123!', body);
    const second = await loginAndApply('token-B', 'employee1', 'Employee123!', body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201); // would be 409 without isolation — this is the exact bug reproduced.

    await first.dispose();
    await second.dispose();
  });

  test('the SAME isolation token still enforces the real overlap business rule', async () => {
    const { api, dispose } = await actor();
    const headers = { [TEST_ISOLATION_HEADER]: 'token-C' };
    await api.post('/api/login', {
      data: { username: 'employee1', password: 'Employee123!' },
      headers,
    });

    const first = await api.post('/api/leave/apply', {
      headers,
      data: { startDate: '2031-02-01', endDate: '2031-02-02', reason: 'first' },
    });
    expect(first.status()).toBe(201);

    const overlapping = await api.post('/api/leave/apply', {
      headers,
      data: { startDate: '2031-02-01', endDate: '2031-02-02', reason: 'overlap' },
    });
    expect(overlapping.status()).toBe(409);

    await dispose();
  });

  test('a manager only sees pending requests from callers sharing their own isolation token', async () => {
    const employee = await actor();
    const employeeHeaders = { [TEST_ISOLATION_HEADER]: 'token-D' };
    await employee.api.post('/api/login', {
      data: { username: 'employee1', password: 'Employee123!' },
      headers: employeeHeaders,
    });
    const applyRes = await employee.api.post('/api/leave/apply', {
      headers: employeeHeaders,
      data: { startDate: '2031-03-01', endDate: '2031-03-02', reason: 'manager visibility check' },
    });
    expect(applyRes.status()).toBe(201);

    const managerSameToken = await actor();
    const sameTokenHeaders = { [TEST_ISOLATION_HEADER]: 'token-D' };
    await managerSameToken.api.post('/api/login', {
      data: { username: 'manager1', password: 'Manager123!' },
      headers: sameTokenHeaders,
    });
    const sameTokenList = await managerSameToken.api.get('/api/leave', {
      headers: sameTokenHeaders,
    });
    const { requests: seenBySameToken } = (await sameTokenList.json()) as {
      requests: { reason: string }[];
    };
    expect(seenBySameToken.some((r) => r.reason === 'manager visibility check')).toBe(true);

    const managerOtherToken = await actor();
    const otherTokenHeaders = { [TEST_ISOLATION_HEADER]: 'token-E' };
    await managerOtherToken.api.post('/api/login', {
      data: { username: 'manager1', password: 'Manager123!' },
      headers: otherTokenHeaders,
    });
    const otherTokenList = await managerOtherToken.api.get('/api/leave', {
      headers: otherTokenHeaders,
    });
    const { requests: seenByOtherToken } = (await otherTokenList.json()) as {
      requests: { reason: string }[];
    };
    expect(seenByOtherToken.some((r) => r.reason === 'manager visibility check')).toBe(false);

    await employee.dispose();
    await managerSameToken.dispose();
    await managerOtherToken.dispose();
  });

  test('a caller that sends no isolation header at all keeps the original (pre-isolation) shared-bucket behavior', async () => {
    const { api, dispose } = await actor();
    await api.post('/api/login', { data: { username: 'employee1', password: 'Employee123!' } });

    const first = await api.post('/api/leave/apply', {
      data: { startDate: '2031-04-01', endDate: '2031-04-02', reason: 'legacy first' },
    });
    expect(first.status()).toBe(201);

    const second = await api.post('/api/leave/apply', {
      data: { startDate: '2031-04-01', endDate: '2031-04-02', reason: 'legacy overlap' },
    });
    expect(second.status()).toBe(409);

    await dispose();
  });
});
