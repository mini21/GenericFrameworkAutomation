# Reporting

Every run produces, under `reports/` (gitignored):

| Artifact                | Path                        | View with                                                       |
| ----------------------- | --------------------------- | --------------------------------------------------------------- |
| Playwright HTML report  | `reports/html-report/`      | `npm run report:show`                                           |
| JUnit XML               | `reports/junit/results.xml` | Consumed natively by Jenkins/Azure DevOps (see `docs/CI-CD.md`) |
| Allure results + report | `reports/allure-results/`   | `npm run report:allure:generate && npm run report:allure:open`  |
| Centralized log file    | `logs/run.log` (gitignored) | Any text viewer / `tail -f logs/run.log`                        |

```bash
npm run report:show                 # opens the Playwright HTML report
npm run report:allure:generate      # builds reports/allure-report/ from raw results
npm run report:allure:open          # serves the generated Allure report
```

## Logging

Every framework layer logs through the single Winston logger
(`src/core/logger/logger.ts`) — never `console.log` (ESLint's `no-console`
rule catches that). It writes to the console (colorized) and to
`logs/run.log` (plain), at the level set by `LOG_LEVEL` (`error` | `warn` |
`info` | `debug`, default `info`).

- **Test lifecycle**: `logger.fixture.ts` auto-logs `Starting test: ...` /
  `Finished test: ...` for every test, and `Test failed: ...` (with the
  error message) when a test doesn't finish with its expected status.
- **API calls**: `ApiClient` logs every request (method, URL, params/body)
  and response (status, duration).
- **DB operations**: `DbClient` logs connect/disconnect/insert/clear at
  debug level.
- **Run summary**: `SummaryReporter` (a native Playwright reporter, runs
  once in the main process) logs a `Run finished: <status>` line and, if
  anything failed, a `Failed tests` line listing them — so a failed CI run
  is diagnosable from `logs/run.log` alone, without opening the HTML report.

Set `LOG_LEVEL=debug` for verbose output (e.g. `LOG_LEVEL=debug npm test`).

## Screenshots, video, trace

Configured in `playwright.config.ts` `use:` block:

- `screenshot: 'only-on-failure'` — automatic, no code needed.
- `video: 'retain-on-failure'`
- `trace: 'retain-on-failure'` — open with `npx playwright show-trace <path-to-trace.zip>` (path is printed in the failure output and attached to the HTML report).

For an **on-demand** screenshot at a specific point in a passing test
(distinct from the automatic failure-only capture), use
`captureScreenshot()`:

```ts
import { captureScreenshot } from '../../src/core/utils/screenshot.util';

await captureScreenshot(page, 'after-checkout');
// -> reports/screenshots/after-checkout-<timestamp>.png
```

## Parallel execution

All of the above works correctly under Playwright's default parallel
workers and across multiple `projects` running concurrently — the native
reporters and `SummaryReporter` run once in the main process (not per
worker), so report artifacts stay well-formed even though each test/worker's
log lines are interleaved in `logs/run.log` (each line is still
individually attributable by test title).
