/**
 * HTTP header the framework attaches to every request a test's `page`
 * (and Playwright's built-in `request` fixture) makes, carrying that
 * test's own stable Playwright `testInfo.testId`. Purely additive and
 * app-agnostic — an application under test MAY read it (e.g. to
 * partition shared mutable state per test-run so concurrent/sequential
 * tests never collide on the same record) but nothing in core requires
 * it. See src/core/fixtures/test-isolation.fixture.ts.
 */
export const TEST_ISOLATION_HEADER = 'x-gap-test-id';
