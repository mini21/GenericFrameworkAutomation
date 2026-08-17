# GAP Platform — Configuration-Driven Automation

How this framework went from "a reusable Playwright framework" to "a
configuration-driven platform QA engineers point at any onboarded
application." Written for QA Automation Engineers — assumes you've read
[docs/TESTING-GUIDE.md](./TESTING-GUIDE.md) already.

## The goal, precisely

Not "give AI a prompt and generate tests." The goal is: a QA engineer
provides structured information —

```
Application: HRMS
Environment: QA
Module: Leave
Test Type: Smoke
Browser: Chromium
```

— and GAP resolves that into a deterministic Playwright execution: the
right project, the right `--grep` tags, the right target URLs, the right
test data profile. No AI/LLM involved anywhere in this path — every
resolution step is plain, inspectable code.

## Architecture

```
                    GAP
                     |
             Generic Core
                     |
       +-------------+-------------+
       |             |             |
      HRMS          CRM         Banking
       |             |             |
       +-------------+-------------+
                     |
              Playwright
                     |
          Allure / CI / Coverage
```

- **Generic Core** (`src/core/`, `cli/`, `config/env.config.ts`,
  `config/applications.json`) has zero knowledge of any specific
  application — no HRMS selectors, no CRM URLs, no application credentials,
  no application business logic. It only knows the _conventions_
  (`applications/<id>/tests/`, `applications/<id>/requirements/
requirements.json`, etc.) and the _contracts_ (`BasePage`, `ApiClient`,
  `DbClient`, the `ui` Locator Intelligence fixture).
- **Applications** (`applications/<id>/`) consume generic core — they never
  modify it. Each is fully isolated from every other application; see
  "Application isolation" below.
- **Playwright** is the actual test runner throughout — GAP is a thin
  orchestration/configuration layer that resolves inputs into native
  Playwright CLI arguments (`--project`, `--grep`, `--workers`, `--retries`,
  `--headed`). There is no custom test runner and no custom DSL.

## Generic core vs. application code

| Generic core (never application-specific)                                                                                               | Application code (lives under `applications/<id>/`)                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/config/application-registry.ts` — reads the registry, knows no application by name                                            | `config/applications.json` — the actual registered applications (data, not code)                                                                              |
| `src/core/execution/*` — manifest loading, resolver, data-profile loader, execution-context reader                                      | `applications/<id>/data/*.json` — the actual data profile content                                                                                             |
| `cli/gap-test.ts`, `cli/gap-onboard.ts`                                                                                                 | `applications/<id>/requirements/requirements.json` — the actual requirements                                                                                  |
| `src/core/locator/*` (Locator Intelligence), `src/core/http/*` (`ApiClient`), `src/core/db/*` (`DbClient`), `src/ui/pages/base.page.ts` | `applications/<id>/pages/`, `applications/<id>/api/`, `applications/<id>/fixtures/` — application-specific composition of the above                           |
| `playwright.config.ts` — application-agnostic `testMatch` globs (`applications/*/tests/**`)                                             | `applications/<id>/tests/` — the actual specs, `applications/<id>/server/` — a reference app's own backend (HRMS only; a real application wouldn't have this) |

The rule of thumb: if a file needs to know an application's _name_, it
belongs under `applications/<id>/`. If it only needs to know the
_convention_ (e.g. "there's a `requirements.json` somewhere under
`applications/<app>/requirements/`), it belongs in generic core.

## Application Registry

`config/applications.json` — the source of truth for what applications
exist and their high-level metadata:

```json
{
  "applications": {
    "hrms": {
      "name": "HRMS Leave Management",
      "baseUrl": "http://localhost:4100",
      "apiBaseUrl": "http://localhost:4100",
      "modules": ["auth", "leave", "approval"],
      "authProfiles": ["employee", "manager"],
      "defaultBrowser": "chromium",
      "supportedBrowsers": ["chromium", "firefox", "webkit"],
      "dataProfiles": ["qa-default"]
    }
  }
}
```

Read via `src/core/config/application-registry.ts`
(`getApplication(id)`/`listApplications()`) — plain JSON, no application
logic in TypeScript. No credentials live here — see Security below.

## Application onboarding

```bash
npm run gap:onboard -- \
  --id=crm \
  --name="CRM" \
  --baseUrl=http://localhost:4200 \
  --apiBaseUrl=http://localhost:4200 \
  --modules=leads,customers \
  --authProfiles=sales \
  --defaultBrowser=chromium \
  --browsers=chromium,firefox \
  --dataProfiles=qa-default
```

This is flag-driven, not an interactive wizard — deterministic and
CI-friendly. It:

1. Adds the application to `config/applications.json`.
2. Scaffolds `applications/crm/{pages,components,api,fixtures,data,
requirements,tests/{ui,api}}/`, an empty `requirements.json`, and empty
   data-profile JSON files.
3. Prints next steps.

Nothing in generic core is touched. See "How a real application would be
onboarded" below for the full checklist beyond what the command generates.

## Execution Manifest

A structured, versionable description of one execution — `config/
execution/*.yml` (or `.json`):

```yaml
application: hrms
environment: qa

execution:
  type: smoke
  browsers:
    - chromium
  headless: true
  workers: 1
  retries: 0

dataProfile: qa-default
```

Every field is optional in the file itself — see Execution Resolver for
what fills the gaps. Loaded via `src/core/execution/execution-manifest.ts`
(`loadManifest(path)`); `.yml`/`.yaml` via `js-yaml`, `.json` via
`JSON.parse` — pick whichever fits your team, both are first-class.

Four examples ship in `config/execution/`: `smoke-hrms-qa.yml`,
`regression-hrms-qa.yml`, `smoke-hrms-qa-firefox.yml`, and
`regression-hrms-qa-all-browsers.yml`.

## Execution Resolver

`src/core/execution/execution-resolver.ts` — `resolveExecution({cli, env,
manifest})` — the one place that turns scattered inputs into a single
`ResolvedExecution`. Precedence, highest wins:

```
CLI flags  >  environment variables (GAP_*)  >  manifest file  >  application defaults (registry)
```

`toPlaywrightArgs(resolved)` then translates that into real Playwright CLI
arguments — `applications/<app>/tests` as the positional path,
`--project=<browser>` per requested browser, a lookahead-composed `--grep`
regex requiring every resolved tag (type tag + `@module.<module>` +
any explicit `--tags`) to be present (AND, not OR — narrowing, not
broadening), `--workers`, `--retries`, `--headed` when not headless.
`toEnv(resolved)` produces the env vars injected into the spawned
Playwright process: `ENV`, `BASE_URL`, `API_BASE_URL` (from the
registry), `GAP_APPLICATION`, `GAP_MODULE`, `GAP_DATA_PROFILE`,
`GAP_AUTH_PROFILE`.

**Important**: `ENV`/`BASE_URL`/`API_BASE_URL` flow through
`config/env.config.ts`'s existing dotenv-based precedence unchanged — a
var the CLI already set in the spawned process's environment always wins
over `.env.local`, which always wins over the committed `.env.<env>`
placeholder. No special-casing needed in `env.config.ts` for GAP-specific
concerns beyond that one precedence fix (see
[docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md)).

## CLI usage

```bash
# Flags
npm run gap:test -- \
  --application=hrms --environment=qa --module=leave --type=smoke \
  --browser=chromium --headless=true --workers=1

# Manifest, with CLI overriding specific fields
npm run gap:test -- --manifest=config/execution/smoke-hrms-qa.yml --type=regression

# See the resolved plan and exact `npx playwright` command without running anything
npm run gap:test -- --application=hrms --dry-run
```

Full flag list: `--application`, `--environment`, `--module`, `--type`
(`smoke`|`regression`|`sanity`|`functional`), `--browser`
(`chromium`|`firefox`|`webkit`|`all`, comma-separated for multiple),
`--headless` (`true`|`false`), `--workers`, `--retries`, `--tags`
(comma-separated, ANDed with the type/module tags), `--data-profile`,
`--auth-profile`, `--manifest`, `--dry-run`.

`GAP_*` environment variables (`GAP_APPLICATION`, `GAP_ENVIRONMENT`,
`GAP_MODULE`, `GAP_TYPE`, `GAP_BROWSER`, `GAP_HEADLESS`, `GAP_WORKERS`,
`GAP_RETRIES`, `GAP_TAGS`, `GAP_DATA_PROFILE`, `GAP_AUTH_PROFILE`) sit
between CLI flags and the manifest in precedence — set them in a CI job's
`env:` block for a job-wide default that individual dispatch inputs can
still override.

### Why compiled, not `ts-node`/`tsx`

`npm run gap:test`/`gap:onboard` first run `npm run gap:build` (`tsc -p
tsconfig.cli.json`, scoped to just `cli/`, `src/core/config`, `src/core/
execution`, `config/`, and `applications/*/server/` — not the whole
`src/core/` tree or any spec files, so it stays fast), then run the
compiled output via plain `node`. This needed a real, standalone
entry point that runs _before_ Playwright even starts (it constructs the
`npx playwright test` invocation), so it couldn't be a Playwright spec —
unlike `tests/coverage/coverage-report.spec.ts`, which reuses Playwright's
own TypeScript toolchain instead. Compiling via the existing `typescript`
devDependency avoided adding `ts-node`/`tsx` as a new dependency.

## Module and test-type selection

Modules and test types both resolve into required `--grep` tags, combined
with AND (a test must carry every one, not just one):

- `--module=leave` requires `@module.leave` on the test.
- `--type=smoke` requires `@smoke` (the type→tag mapping:
  `smoke`→`@smoke`, `regression`→`@regression`, `sanity`→`@sanity`,
  `functional`→`@functional`).
- `--tags=@application.hrms` (or any other explicit tags) narrows further.

A spec opts in with Playwright's native `tag` test option:

```ts
test(
  'employee can apply for leave',
  { tag: ['@application.hrms', '@module.leave', '@smoke', '@hrms.leave.apply.valid'] },
  async ({ page, ui }) => {
    /* ... */
  },
);
```

(`@hrms.leave.apply.valid` here is the _stable test ID_ for requirement
coverage — see [docs/COVERAGE.md](./COVERAGE.md); it plays no role in
module/type selection.)

## Browser selection

`--browser=chromium|firefox|webkit` selects one; comma-separated
(`--browser=chromium,firefox`) or `--browser=all` (expands to the
application's `supportedBrowsers` from the registry) selects several — each
becomes its own `--project=<browser>` flag, so Playwright runs them exactly
as it always does. The resolver validates every requested browser is
actually in the application's `supportedBrowsers` list and throws a clear
error otherwise.

`--headless=false` maps to Playwright's `--headed`. `--workers`/`--retries`
map directly to Playwright's own flags of the same name — GAP invents no
new execution semantics here.

## GitHub Actions usage

`.github/workflows/gap-manual-run.yml` — `workflow_dispatch` with one input
per CLI flag (`application`, `environment`, `module`, `testType`,
`browser`, `headless`, `workers`, `tags`, `manifest`). The workflow's only
job is translating those dropdown inputs into `npm run gap:test --
<flags>` — **all actual decision-making happens inside the GAP CLI**, not
in YAML. It also runs `GAP_APPLICATION=<app> npm run coverage:report`
after the test run and uploads `reports/` + `test-results/` as a build
artifact either way.

Run it: repo → Actions → "GAP Manual Run" → Run workflow → fill in the
dropdowns.

Adding an application's `id` to the `application` input's `options:` list
in that YAML file is the one place onboarding a new application still
touches shared CI wiring (a presentation-layer concern, not generic core)
— everything else about onboarding stays entirely under
`applications/<id>/`.

## Azure DevOps usage

No second execution engine — the same GAP CLI, called from an
`azure-pipelines.yml` step exactly like any other npm script:

```yaml
trigger: none

parameters:
  - name: application
    type: string
    default: hrms
  - name: environment
    type: string
    default: qa
  - name: testType
    type: string
    default: smoke
  - name: browser
    type: string
    default: chromium

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: npx playwright install --with-deps ${{ parameters.browser }}
    displayName: 'Install Playwright browser'

  - script: |
      npm run gap:test -- \
        --application=${{ parameters.application }} \
        --environment=${{ parameters.environment }} \
        --type=${{ parameters.testType }} \
        --browser=${{ parameters.browser }}
    displayName: 'Run GAP CLI'

  - script: GAP_APPLICATION=${{ parameters.application }} npm run coverage:report
    displayName: 'Generate coverage report'
    condition: always()
    continueOnError: true

  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: 'reports/junit/results.xml'

  - task: PublishBuildArtifacts@1
    condition: always()
    inputs:
      pathToPublish: 'reports'
      artifactName: 'gap-reports'
```

Jenkins works the same way (see [docs/CI-CD.md](./CI-CD.md) for a
declarative-pipeline example using the same npm scripts) — any CI system
that can run `npm run gap:test -- <flags>` can drive GAP.

## Locator Intelligence and Coverage

Both fully reused, unmodified, from the prior milestone — nothing here
replaces them:

- **Locator Intelligence** — every HRMS UI spec uses `ui.click(name)`/
  `ui.fill(name, value)` exclusively, no raw CSS/XPath in any HRMS test.
  Full behavior: [docs/LOCATOR-INTELLIGENCE.md](./LOCATOR-INTELLIGENCE.md).
- **Coverage** — the calculator/report logic in `src/core/coverage/` is
  unchanged; the only addition is _which_ `requirements.json` it reads —
  an application's own (`applications/<app>/requirements/requirements.json`,
  selected via the `GAP_APPLICATION` env var the CLI injects) instead of
  the framework-level one, with reports written to
  `reports/coverage/<app>/` instead of `reports/coverage/`. Full behavior,
  including the pass-rate-vs-coverage distinction:
  [docs/COVERAGE.md](./COVERAGE.md).

## Reference application: HRMS Leave Management

Proves the whole platform against a real (if small) application rather
than an abstract claim. `applications/hrms/`:

- **`server/`** — an Express app (`app.ts`) plus five static HTML pages
  (`public/`) — login, dashboard, apply-leave, leave-history, approvals.
  In-memory data only (no database — a real onboarded application
  typically wouldn't ship its own backend at all; this exists purely so
  the reference app is self-contained and runnable with nothing external).
  Started automatically by Playwright's native `webServer` config option
  (`playwright.config.ts`) — no custom process orchestration.
- **Three seeded users**, each isolated to one test file so parallel
  workers never race on the same employee's leave-request state: `employee1`
  (leave.spec.ts), `employee2` (approval.spec.ts, via API setup),
  `employee3` (leave-api.spec.ts), plus `manager1`. All fake, local-only
  credentials — see Security below.
- **8 requirements** (`applications/hrms/requirements/requirements.json`):
  `AUTH-001/002`, `LEAVE-001..004`, `APPROVAL-001/002` — 100% covered,
  100% Critical coverage, by 9 real tests (8 UI + 1 API).
- **Tests** (`applications/hrms/tests/{ui,api}/`) use `ui.click`/`ui.fill`
  directly rather than page objects — deliberately, to demonstrate the
  "QA engineer shouldn't need raw locators" goal as directly as possible.
  A real, larger application would likely still use page objects for
  complex, heavily-reused flows; both patterns are fully supported (see
  [docs/TESTING-GUIDE.md](./TESTING-GUIDE.md)).
- **`leave.spec.ts`/`approval.spec.ts` run `test.describe.configure({mode:
'serial'})`** and every test cleans up its own data — the shared
  in-memory backend means true parallel workers could otherwise make
  `ui.click('Approve')`-style assertions ambiguous (two pending rows =
  two "Approve" buttons). The example manifests default to `workers: 1`
  for full determinism. A real application with proper per-test data
  isolation (isolated test users created via API per test, or a real
  database with transactional rollback) wouldn't need this constraint —
  it's a reference-app characteristic, not a GAP platform limitation.

## Application isolation

The critical architecture claim: adding HRMS required zero changes to
`src/core/browser/browser-manager.ts`, `src/core/config/
environment-manager.ts`, `src/core/fixtures/*.ts`, `src/core/reporter/
summary-reporter.ts` (beyond the pass-rate/coverage logging work that
predates HRMS entirely), or any other generic utility. Every HRMS-specific
line of code lives under `applications/hrms/`. `playwright.config.ts`
needed exactly one _pattern_ (`applications/*/tests/**`), not a
per-application entry — onboarding CRM tomorrow needs zero edits there
either, only a new `applications/crm/` tree the existing glob already
covers.

## How a real application would be onboarded

The `gap:onboard` command handles the mechanical scaffolding. Beyond that,
for a real (non-reference) application:

1. Run `gap:onboard` with the real `baseUrl`/`apiBaseUrl`/`modules`/
   `authProfiles`/`browsers`/`dataProfiles`.
2. Write page objects/API clients under `applications/<id>/{pages,api}/`
   against the existing `BasePage`/`ApiClient` contracts (see
   [docs/TESTING-GUIDE.md](./TESTING-GUIDE.md)) — or use `ui.click`/
   `ui.fill` directly, as HRMS does.
3. Fill in `applications/<id>/requirements/requirements.json` with real
   requirement IDs mapped to stable test IDs.
4. Write specs under `applications/<id>/tests/{ui,api}/`, tagging each
   with `@application.<id>`, `@module.<module>`, a test-type tag, and a
   stable coverage ID.
5. Fill in `applications/<id>/data/<profile>.json` with real (non-secret)
   test data; real credentials come from environment variables/CI
   secrets, never committed — see Security below.
6. Add `<id>` to `.github/workflows/gap-manual-run.yml`'s `application`
   input options (the one CI-wiring touchpoint noted above).
7. Run `npm run gap:test -- --application=<id> --type=smoke` and iterate.

No step here requires touching generic core.

## Security

Never committed: real credentials, API tokens, or secrets — in source,
manifests, the application registry, GitHub workflows, or test files. Use
environment variables locally and GitHub Secrets/CI secret variables in
CI, exactly as `docs/CONFIGURATION.md` and `docs/CI-CD.md` already
document for the rest of the framework. HRMS's `employee1`/`Employee123!`-
style credentials are fake, local-only, reference-app values — the same
pattern already used for the-internet.herokuapp.com's public demo login
elsewhere in this repo (see `docs/ARCHITECTURE.md`'s scaffolding table) —
not a precedent for how a real application's credentials should be
handled.

## No AI dependency

Nothing in this platform — onboarding, the registry, the manifest loader,
the execution resolver, the CLI, module/type/browser selection, Locator
Intelligence, or coverage — calls out to Claude, ChatGPT, an LLM API, or
any external AI service. Every resolution step is plain TypeScript you can
read start to finish in `src/core/execution/execution-resolver.ts`. The
framework runs fully offline/local/CI using deterministic configuration
and code.
