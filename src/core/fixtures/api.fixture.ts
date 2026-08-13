import { test as base, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { ApiClient } from '../http/api-client';
import { EnvironmentManager } from '../config/environment-manager';

export const test = base.extend<{ api: ApiClient }, { apiRequestContext: APIRequestContext }>({
  apiRequestContext: [
    async ({}, use) => {
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

      const context = await playwrightRequest.newContext({
        baseURL: EnvironmentManager.apiBaseUrl,
        extraHTTPHeaders: headers,
      });
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  api: async ({ apiRequestContext }, use) => {
    await use(new ApiClient(apiRequestContext));
  },
});

export { expect } from '@playwright/test';
