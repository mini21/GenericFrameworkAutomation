# Troubleshooting

Known issues and their fixes, including a few discovered and fixed while
building this framework — kept here so they don't get silently
rediscovered.

## A reference-app UI test passes alone but fails when multiple browser projects run together

**Symptom**: `applications/hrms/tests/ui/leave.spec.ts` or `approval.spec.ts`
passes under `--project=chromium` alone, but fails under
`--project=chromium --project=firefox` together — either a
`getByText(...)` strict-mode violation ("resolved to 2 elements") or a
leave-application API call returning `409` instead of `201`.

**Cause**: every browser project runs the _same_ spec against the _same_
shared in-memory HRMS backend (one Express process, `webServer` in
`playwright.config.ts`). A test with a hardcoded reason string or date
range creates identical data on each browser's run — the second browser's
`getByText('Family trip')` then matches its own row _and_ the first
browser's leftover row, or its "apply for leave" collides with the first
browser's still-pending/approved request for the same (or even just
adjacent — the overlap check treats touching ranges as overlapping) dates.

**Fix**: already applied in `applications/hrms/fixtures/hrms-auth.ts`
(`dayOffsetForProject`) and both spec files — reason strings get a random
suffix (`uniqueReason()`), and date ranges get a deterministic per-project
offset wide enough (5-day blocks) that no test's range can reach into
another project's block. This is a reference-app-specific concern from
sharing one backend process across browsers; it doesn't apply to specs
that create their own isolated data per test run against a real,
per-test-isolated backend.

## Playwright's positional test-path argument matches by substring/regex, not by directory prefix

**Symptom**: `npx playwright test tests/ui` (intending "only the
framework's own `tests/ui/` specs") also picks up
`applications/hrms/tests/ui/*.spec.ts`, because that path _contains_ the
substring `tests/ui` too.

**Fix**: not a bug to fix — it's how Playwright's CLI path filtering
works (regex/substring match against the resolved file path, not a
directory-prefix match). To target only the framework's own specs
unambiguously, use an absolute path (`"$(pwd)/tests/ui/login.spec.ts"`) or
list files individually with paths that don't happen to be suffixes of an
application's path. In normal use this never comes up — the GAP CLI always
targets `applications/<app>/tests` for application runs and the framework's
own `npm test`/`npm run test:*` scripts already point at specific
framework directories.

## The GAP CLI resolves an application's URL correctly, but tests still hit a different site

**Symptom**: `npm run gap:test -- --application=hrms ...` prints a
resolved plan with the right `baseUrl` in its `Global setup` log line, but
`ui.click`/`ui.fill` still fail to find elements — because the browser
actually navigated somewhere else entirely (e.g. a leftover `.env.local`
target from earlier local scaffolding work).

**Cause**: `.env.local` used to load with dotenv's `override: true`
unconditionally — correct for its _original_ purpose (override the
committed `.env.<env>` placeholder for local secrets), but it meant
`.env.local` clobbered `BASE_URL`/`API_BASE_URL` even when the GAP CLI had
already deliberately injected an application's real URL into the spawned
process's environment before Playwright even started.

**Fix**: already applied in `config/env.config.ts` — `.env.local` now only
fills in keys that weren't already present in `process.env` _before_
`env.config.ts` ran at all, so a value the CLI (or CI, or your shell)
explicitly set always wins. If you still see this, check whether something
else is overriding `BASE_URL`/`API_BASE_URL` after that point.

## An occasional UI test fails locally under a full parallel run, but passes standalone or on re-run

**Cause**: the UI example specs hit a real third-party public practice site
(the-internet.herokuapp.com), which occasionally responds slowly under the
concurrent load of many local Playwright workers hitting it at once. This
is network flakiness in the scaffolding target, not a bug in the framework
or the test logic — locally, `retries` is `0` (see `playwright.config.ts`);
in CI it's `2`, which absorbs this automatically.

**Fix**: re-run the specific test; if it passes standalone
(`--project=firefox tests/ui/login.spec.ts`), it's this. Once a real target
application replaces the practice site (see `docs/ARCHITECTURE.md`), this
category of flakiness goes away entirely. If you want retries locally too,
pass `--retries=1` or set `CI=true` locally.

## `browserType.launch:` fails immediately (WebKit especially)

**Symptom**: `npx playwright install` downloads the browser binary fine,
but launching it fails with a generic error, or `playwright install` prints
a "Host system is missing dependencies" warning listing shared libraries
(`libflite*`, `libavif*`, `libx264`, etc.).

**Cause**: Playwright browsers need OS-level shared libraries beyond the
browser binary itself. `npx playwright install` only downloads the binary;
`npx playwright install --with-deps` also installs the OS packages, which
needs `sudo`/root.

**Fix**: `sudo npx playwright install --with-deps` (or run in the official
`mcr.microsoft.com/playwright` Docker image, which has everything
preinstalled — see `docs/DOCKER.md`). In a sandboxed/CI environment without
root access, you may only be able to run a subset of browsers (Chromium and
Firefox tend to have fewer missing-dependency issues than WebKit).

## `Missing required environment variable(s): BASE_URL, API_BASE_URL`

**Cause**: `config/env.config.ts` validates these are present after loading
`.env.<ENV>` + any `.env.local` override. The committed `.env.<env>` files
ship with placeholder `https://*.example.com` URLs by design (see
`docs/CONFIGURATION.md`) — this error means neither the placeholder nor a
real override resolved (e.g. a typo in `.env.local`, or wrong `ENV` value).

**Fix**: `cp .env.example .env.local` and fill in real values, or export
`BASE_URL`/`API_BASE_URL` directly in your shell/CI job.

## Allure results end up in `./allure-results` at the repo root, not `reports/allure-results`

**Cause**: `allure-playwright` v3 renamed its output-folder config option
from `outputFolder` (v2) to `resultsDir`. Passing `outputFolder` in
`playwright.config.ts`'s reporter array silently no-ops instead of erroring
— the reporter just falls back to its default location. Check your
installed version (`npm ls allure-playwright`) before assuming the option
name from an older tutorial/example still applies.

**Fix**: already applied in this repo — `playwright.config.ts` uses
`['allure-playwright', { resultsDir: 'reports/allure-results' }]`. If you
see the stray `allure-results/` directory reappear, something reverted this.

## `node:sqlite` fails to load under Playwright's test runner

**Symptom**: `TypeError: Expected a string, an ArrayBuffer, or a
TypedArray to be returned for the "source" from the "load" hook but got
null`, pointing at an import of `node:sqlite`.

**Cause**: Node's built-in `node:sqlite` module (stable from Node ~22.5) is
new enough that Playwright's TypeScript/module transform doesn't handle it
correctly as of `@playwright/test` ~1.6x — the built-in module has no
resolvable "source" for the loader to read.

**Fix**: this is why `src/core/db/db-client.ts` uses a pure-TypeScript
in-memory implementation instead of `node:sqlite` or a native driver like
`better-sqlite3` — zero risk of loader incompatibility, zero install step.
If you replace it with a real driver later, prefer a pure-JS or
prebuilt-binary driver (e.g. `pg` for Postgres) over anything requiring a
native compile step, to avoid similar toolchain friction in CI/Docker.

## A test project silently reruns specs from another project

**Symptom**: running the full suite shows the same API spec executing
under `chromium`, `firefox`, `webkit`, _and_ `api` — 3x more runs than
expected, browsers launched for tests that never touch `page`.

**Cause**: a Playwright `project` without a `testDir`/`testMatch`/
`testIgnore` inherits the top-level `testDir` and picks up **every** spec
under it, including ones meant for a different project.

**Fix**: already applied — `chromium`/`firefox`/`webkit` projects in
`playwright.config.ts` have `testIgnore: ['**/api/**']`; the `api` project
has `testDir: './tests/api'`. If you add a new test folder meant for only
one project, scope it explicitly the same way.

## `.env.local` values don't seem to apply in CI

**Cause**: `.env.local` is gitignored by design (it's for local secret
overrides) — it doesn't exist in CI. `config/env.config.ts` only reads
`.env.local` if the file is present on disk.

**Fix**: set the same variables as CI environment variables/secrets
instead (see `docs/CI-CD.md`). `dotenv.config()` (used to load the
committed `.env.<env>` file) never overrides a variable already present in
`process.env`, so CI-level env vars automatically take precedence over the
committed placeholders — you don't need a CI-specific `.env` file.

## Husky pre-commit hook fails or is skipped

**Symptom**: `.git can't be found` printed during `npm install` inside a
Docker build, or in any context where `.git/` isn't present.

**Cause**: `package.json`'s `prepare` script is `husky || exit 0` —
intentionally tolerant of a missing `.git` directory (e.g. inside a Docker
build context, which excludes `.git/` via `.dockerignore`). This is
expected and harmless in that context; it should **not** happen in a normal
local clone with `.git/` present — if it does there, check that you're not
running `npm install` from within a `.dockerignore`d or otherwise
git-stripped copy of the repo.
