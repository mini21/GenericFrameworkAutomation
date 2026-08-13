import { defineConfig, devices } from '@playwright/test';
import { config } from './config/env.config';

// API specs are excluded from every browser project — they use the `api`
// fixture, never `page`, and have their own dedicated `api` project below.
// Running them per-browser would triple their runtime for no added
// coverage.
const API_SPECS = ['**/api/**'];

// Coverage report generation shells out to a separate `playwright test
// --list` invocation (see src/core/coverage/test-discovery.ts) — no
// browser involved, and running it 3x per browser would triple that
// subprocess cost for no benefit. Has its own dedicated project below.
const COVERAGE_SPECS = ['**/coverage/**'];

// db-client.spec.ts only exercises the `db` fixture too (no browser), but
// unlike API specs it has no dedicated non-browser project of its own — so
// it needs exactly one browser project to actually run it. It's excluded
// from firefox/webkit (redundant) but kept on chromium (its sole runner).
// This list doesn't self-enforce: a new non-browser spec added under
// tests/e2e/ needs a similar decision made explicitly, or it'll either run
// 3x redundantly or (if blanket-excluded from all three) not run at all.
const DB_ONLY_SPECS = ['**/db-client.spec.ts'];

export default defineConfig({
  testDir: './tests',
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
      testIgnore: [...API_SPECS, ...COVERAGE_SPECS],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: [...API_SPECS, ...DB_ONLY_SPECS, ...COVERAGE_SPECS],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: [...API_SPECS, ...DB_ONLY_SPECS, ...COVERAGE_SPECS],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: {},
    },
    {
      name: 'coverage',
      testDir: './tests/coverage',
      use: {},
    },
  ],
});
