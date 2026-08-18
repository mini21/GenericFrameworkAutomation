import { test as base } from '@playwright/test';
import { TEST_ISOLATION_HEADER } from '../constants';
import { getApplication } from '../config/application-registry';

const APPLICATION_DIR_PATTERN = /applications[\\/]([^\\/]+)[\\/]/;

/**
 * A single global BASE_URL (from playwright.config.ts's project-level
 * `use.baseURL`, itself set once at config-load time — see
 * config/env.config.ts's `inferApplicationFromArgv`) can only ever guess
 * right when the invocation happens to name exactly one application on
 * the command line. `npx playwright test --project=chromium` (no file
 * path) or a bare `npx playwright test` names none, so every test — this
 * application's own spec files included — silently got the framework's
 * generic example target instead, and every locator/API call inside it
 * failed against the wrong site. Every spec file already lives under the
 * `applications/<id>/` convention the rest of the framework relies on
 * (playwright.config.ts's own testMatch globs, execution-resolver.ts,
 * etc.), so the file itself already names its application unambiguously —
 * this reads that instead of trying to infer one global value for the
 * whole run. A file with no `applications/<id>/` segment (a framework
 * generic/example spec) or an id not present in the registry keeps
 * whatever `contextOptions.baseURL` already resolved to.
 */
function applicationBaseUrl(specFile: string): string | undefined {
  const id = APPLICATION_DIR_PATTERN.exec(specFile)?.[1];
  if (!id) return undefined;
  try {
    return getApplication(id).baseUrl;
  } catch {
    return undefined;
  }
}

/**
 * Two responsibilities, both generic/app-agnostic, both fixing "this test
 * behaved differently run alongside others than run alone":
 *
 * 1. Resolves `baseURL` from the spec file's own `applications/<id>/`
 *    directory rather than a single global value guessed once at
 *    config-load time from CLI argv (see applicationBaseUrl above).
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
    await use(applicationBaseUrl(testInfo.file) ?? baseURL);
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
