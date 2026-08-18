import { test as base, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { ApiClient } from '../http/api-client';
import { EnvironmentManager } from '../config/environment-manager';
import { applicationForSpecFile } from '../config/application-registry';

export const test = base.extend<{ api: ApiClient; apiRequestContext: APIRequestContext }>({
  // Test-scoped (not worker-scoped): a worker-scoped context is built ONCE
  // from a single global apiBaseUrl and then reused for every spec file
  // that worker happens to run — fine when every file targets the same
  // application, wrong the moment a worker runs specs from two different
  // applications/<id>/ directories in one session. Resolving per-test from
  // the spec file's own directory (see test-isolation.fixture.ts for the
  // same pattern applied to `page`/the built-in `request` fixture) is what
  // makes that safe.
  apiRequestContext: async ({}, use, testInfo) => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    // Optional, environment-sourced — never hardcoded. Unset in public
    // test-API setups; populate API_AUTH_TOKEN once a real API needing
    // auth is targeted.
    if (EnvironmentManager.apiAuthToken) {
      headers.Authorization = `Bearer ${EnvironmentManager.apiAuthToken}`;
    }

    const app = applicationForSpecFile(testInfo.file);
    const baseURL = app ? (app.apiBaseUrl ?? app.baseUrl) : EnvironmentManager.apiBaseUrl;

    const context = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: headers });
    await use(context);
    await context.dispose();
  },

  api: async ({ apiRequestContext }, use) => {
    await use(new ApiClient(apiRequestContext));
  },
});

export { expect } from '@playwright/test';
