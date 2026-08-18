import { defineConfig, devices } from '@playwright/test';
import { config } from './config/env.config';

// testDir is the repo root (not './tests') specifically so applications'
// own test suites — applications/<app>/tests/** — are discovered
// automatically via the globs below. Onboarding a new application never
// requires editing this file: it just needs to exist under that path.
const UI_TEST_MATCH = [
  'tests/ui/**/*.spec.ts',
  'tests/e2e/**/*.spec.ts',
  'tests/locator/**/*.spec.ts',
  'tests/discovery/**/*.spec.ts',
  'applications/*/tests/ui/**/*.spec.ts',
  'applications/*/tests/e2e/**/*.spec.ts',
];

// Specs that only exercise a fixture/pure function (no browser fixture
// requested) but have no dedicated non-browser project of their own —
// kept on chromium only, excluded from firefox/webkit to avoid running
// them 3x redundantly.
const CHROMIUM_ONLY_SPECS = ['**/db-client.spec.ts', '**/application-map-writer.spec.ts'];

const API_TEST_MATCH = ['tests/api/**/*.spec.ts', 'applications/*/tests/api/**/*.spec.ts'];
const COVERAGE_TEST_MATCH = ['tests/coverage/**/*.spec.ts'];
const INTENT_TEST_MATCH = ['tests/intent/**/*.spec.ts'];
const GENERATION_TEST_MATCH = ['tests/generation/**/*.spec.ts'];
const EXECUTION_TEST_MATCH = ['tests/execution/**/*.spec.ts'];
// A second test TYPE (distinct from UI/API), added the same way any team
// would extend the execution model for their own type (e.g. load) without
// touching anything above: one testMatch + one project here, then specs
// live under the same applications/<id>/tests/<type>/ convention as every
// other type — no per-application core-code changes needed after that.
const RESPONSIVE_TEST_MATCH = [
  'tests/responsive/**/*.spec.ts',
  'applications/*/tests/responsive/**/*.spec.ts',
];

export default defineConfig({
  testDir: '.',
  globalSetup: './src/core/global-setup.ts',
  globalTeardown: './src/core/global-teardown.ts',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  outputDir: 'test-results/',
  reporter: [
    ['html', { outputFolder: 'reports/html-report', open: 'never' }],
    ['junit', { outputFile: 'reports/junit/results.xml' }],
    ['allure-playwright', { resultsDir: 'reports/allure-results' }],
    ['list'],
    ['./src/core/reporter/summary-reporter.ts'],
  ],
  // Native Playwright app-under-test lifecycle management — no custom
  // process orchestration. Idempotent locally (reuseExistingServer skips
  // startup if already running); every run pays the HRMS build+boot cost
  // once, even one that only touches the framework's own generic examples.
  // See docs/PLATFORM.md for why this tradeoff was accepted.
  webServer: {
    command: 'npm run hrms:start',
    url: 'http://localhost:4100/login.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: config.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      testMatch: UI_TEST_MATCH,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: UI_TEST_MATCH,
      testIgnore: CHROMIUM_ONLY_SPECS,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: UI_TEST_MATCH,
      testIgnore: CHROMIUM_ONLY_SPECS,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'api',
      testMatch: API_TEST_MATCH,
      use: {},
    },
    {
      name: 'coverage',
      testMatch: COVERAGE_TEST_MATCH,
      use: {},
    },
    {
      name: 'intent',
      testMatch: INTENT_TEST_MATCH,
      use: {},
    },
    {
      name: 'generation',
      testMatch: GENERATION_TEST_MATCH,
      use: {},
    },
    {
      name: 'execution',
      testMatch: EXECUTION_TEST_MATCH,
      use: {},
    },
    {
      name: 'responsive',
      testMatch: RESPONSIVE_TEST_MATCH,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
