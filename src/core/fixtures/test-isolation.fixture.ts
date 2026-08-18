import { test as base } from '@playwright/test';
import { TEST_ISOLATION_HEADER } from '../constants';
import { applicationForSpecFile } from '../config/application-registry';

/**
 * Two responsibilities, both generic/app-agnostic, both fixing "this test
 * behaved differently run alongside others than run alone":
 *
 * 1. Resolves `baseURL` from the spec file's own `applications/<id>/`
 *    directory rather than a single global value guessed once at
 *    config-load time from CLI argv (see application-registry.ts's
 *    `applicationForSpecFile`).
 * 2. Stamps every request the test makes — page navigation, in-page
 *    fetch/XHR (extraHTTPHeaders applies context-wide), and Playwright's
 *    own built-in `request` fixture (it shares this `contextOptions`
 *    fixture with `context`/`page`) — with that one test's stable
 *    `testInfo.testId`. Two different tests never send the same value,
 *    and every actor a single test drives (e.g. an employee session via
 *    `page` and a separate API login via `request`) sends the *same*
 *    value, so an application can correlate them. Whether an application
 *    actually partitions its own state by it (see the HRMS reference
 *    server) is entirely up to that application — core has no opinion.
 */
export const test = base.extend({
  // `baseURL` is its own fixture (defaulting to PLAYWRIGHT_TEST_BASE_URL,
  // set once from playwright.config.ts's project-level `use.baseURL`) —
  // NOT part of `contextOptions`, so it has to be overridden here directly
  // rather than folded into the contextOptions object below.
  baseURL: async ({ baseURL }, use, testInfo) => {
    await use(applicationForSpecFile(testInfo.file)?.baseUrl ?? baseURL);
  },

  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        [TEST_ISOLATION_HEADER]: testInfo.testId,
      },
    });
  },
});

export { expect } from '@playwright/test';
