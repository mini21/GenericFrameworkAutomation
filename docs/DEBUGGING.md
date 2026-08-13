# Debugging

## Run headed (watch the browser)

```bash
npm run test:headed
npx playwright test tests/ui/login.spec.ts --headed --project=chromium
```

## Playwright Inspector (step through a test)

```bash
npm run test:debug
npx playwright test tests/ui/login.spec.ts --debug
```

Opens the Inspector: step line-by-line, inspect locators, and use "Pick
locator" to generate a selector interactively.

## Trace viewer (after the fact)

Every failure retains a trace (`playwright.config.ts` →
`trace: 'retain-on-failure'`). The failure output prints the exact command:

```bash
npx playwright show-trace test-results/<test-folder>/trace.zip
```

The trace viewer shows a full timeline: DOM snapshots at every step,
network requests, console logs, and the exact action that failed. This is
almost always faster than re-running the test to reproduce a UI failure.

## VS Code extension

The [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright)
extension runs/debugs individual tests from the editor gutter and uses the
same fixtures/config as the CLI — no extra setup needed.

## Reading a failure

A failed test's console output includes, in order:

1. The assertion diff (expected vs. received).
2. The exact line in your spec/page-object where it failed.
3. Attachment paths: screenshot, video, trace, and (for network-heavy
   failures) an `error-context.md` snapshot of the page's accessibility tree
   at the moment of failure.

For API failures, check `logs/run.log` first — every request/response is
logged with status and duration, often showing the problem (wrong status
code, unexpected body) before you even open the trace.

## Common failure patterns

| Symptom                                                            | Likely cause                                                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing required environment variable(s): BASE_URL, API_BASE_URL` | No `.env.local` and the committed `.env.<env>` placeholder wasn't overridden — see `docs/CONFIGURATION.md`.                            |
| Test times out waiting for a locator                               | Check the trace viewer's DOM snapshot at the timeout point — the element may not exist, or a prior step silently failed.               |
| `browserType.launch:` fails immediately                            | Missing OS-level browser dependencies — run `npx playwright install --with-deps`; see `docs/TROUBLESHOOTING.md`.                       |
| A flaky UI test passes on retry but fails standalone               | Likely a race condition (missing `waitFor`/assertion before acting) — the retry is a CI safety net, not a fix; treat it as a real bug. |

See also [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for
environment-specific known issues.
