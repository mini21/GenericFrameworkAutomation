# Test Automation Framework

Enterprise-grade, generic Test Automation Framework built on **Playwright +
TypeScript**, supporting UI automation, API automation, database test-data
management, cross-browser execution, multi-environment configuration,
parallel execution, and tagged test runs.

> **Status: framework complete.** Every layer described below is
> implemented and verified end-to-end. The UI/API/DB examples run against
> public scaffolding targets (a practice site and a public test API) — swap
> those for your real application once you have one; nothing about the
> framework itself needs to change to do that. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what's generic
> (keep) vs. example scaffolding (replace).

## Prerequisites

- Node.js >= 18 (repo developed/tested on Node 22)
- npm >= 10
- Docker (optional, for containerized runs — see [docs/DOCKER.md](docs/DOCKER.md))

## Getting Started

```bash
npm install
npx playwright install --with-deps   # download browser binaries + OS deps
cp .env.example .env.local            # optional: local secret overrides
```

Then run the suite:

```bash
npm test                 # full suite, ENV=qa
npm run test:ui          # UI specs only
npm run test:api         # API specs only
npm run test:smoke       # tests tagged @smoke
npm run test:regression  # tests tagged @regression
npm run test:dev         # run against the dev environment
npm run test:locator     # Locator Intelligence's own dedicated test suite
npm run coverage:report  # generate the requirement-coverage report
```

See [`package.json`](./package.json) for the full script list, or
[docs/TESTING-GUIDE.md](docs/TESTING-GUIDE.md) for a walkthrough of writing
and running tests.

## Project Structure

```
config/            Environment files (.env.<env>) and the typed config loader
docker/             Dockerfile for containerized execution
docs/               Guides — see Documentation section below
src/core/           Framework internals: fixtures, logger, reporter, http client,
                    db client, browser manager, global setup/teardown, utils
src/ui/             Page Objects and Component Objects
src/api/            API endpoint clients
tests/              Specs, organized by type (ui / api / e2e)
test-data/          Static fixtures, dynamic Faker-based factories, builders
.github/workflows/  GitHub Actions CI
```

Full rationale for this layout — including what's generic framework code
vs. swappable example scaffolding — is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's implemented

| Layer                | Where                                                       | Notes                                                                                                                         |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Config               | `config/env.config.ts`                                      | Sole `process.env` reader; typed `AppConfig`; env-file + `.env.local` override                                                |
| Logging              | `src/core/logger/`, `src/core/fixtures/logger.fixture.ts`   | Winston, console+file, auto-logs test start/finish/failure                                                                    |
| Reporting            | `playwright.config.ts`, `src/core/reporter/`                | HTML + JUnit + Allure + custom `SummaryReporter`                                                                              |
| Browser management   | `src/core/browser/browser-manager.ts`                       | For use outside the standard per-test fixture lifecycle                                                                       |
| API automation       | `src/core/http/`, `src/core/fixtures/api.fixture.ts`        | `ApiClient` (retry, error handling), schema validation, bearer-token auth                                                     |
| UI automation        | `src/ui/pages/`, `src/core/fixtures/ui.fixture.ts`          | Page Object Model, `BasePage`, example pages                                                                                  |
| Auth session reuse   | `src/core/fixtures/auth.fixture.ts`                         | Worker-scoped login-once via `storageState`                                                                                   |
| Database             | `src/core/db/`, `src/core/fixtures/db.fixture.ts`           | Generic `DbClient` interface + safe in-memory example implementation                                                          |
| Test data            | `test-data/`                                                | Static JSON, Faker factories, builders, env-specific data lookup                                                              |
| Locator Intelligence | `src/core/locator/`, `src/core/fixtures/locator.fixture.ts` | `ui.click`/`ui.fill` — deterministic role→label→placeholder→text→testid→css→xpath resolution, confidence levels, self-healing |
| Test Coverage        | `src/core/coverage/`, `tests/coverage/`                     | Requirement-to-test traceability (not pass-rate-as-coverage); `npm run coverage:report`                                       |
| CI/CD                | `.github/workflows/ci.yml`, `docs/CI-CD.md`                 | GitHub Actions implemented; Jenkins/Azure DevOps documented                                                                   |
| Docker               | `docker/Dockerfile`, `docker-compose.yml`                   | Official Playwright base image — browsers preinstalled                                                                        |

## Configuration & Environments

Environment is selected via the `ENV` variable (`dev` | `qa` | `staging` | `prod`, defaults to `qa`):

```bash
ENV=staging npm test
```

Details on required variables and secret handling:
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Tooling

| Concern     | Tool                                                              |
| ----------- | ----------------------------------------------------------------- |
| Test runner | Playwright Test                                                   |
| Language    | TypeScript (strict mode)                                          |
| Linting     | ESLint (flat config) + typescript-eslint                          |
| Formatting  | Prettier + EditorConfig                                           |
| Git hooks   | Husky + lint-staged (runs lint/format on staged files pre-commit) |
| Reporting   | Playwright HTML, JUnit XML, Allure, custom SummaryReporter        |
| Logging     | Winston                                                           |
| Test data   | Static JSON + Faker-based factories + builders                    |
| Database    | Generic `DbClient` interface, in-memory example implementation    |
| CI          | GitHub Actions (Jenkins/Azure DevOps documented)                  |
| Containers  | Docker (official Playwright image)                                |

```bash
npm run lint          # check
npm run lint:fix      # check + fix
npm run format         # write formatting
npm run format:check  # check only
npm run typecheck     # tsc --noEmit
```

## Documentation

| Guide                                                | What's in it                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)                 | Design rationale, folder-by-folder reference, execution flow, generic vs. example scaffolding |
| [Configuration](docs/CONFIGURATION.md)               | Environment variables, secrets handling, adding a new environment                             |
| [Testing Guide](docs/TESTING-GUIDE.md)               | Writing UI/API tests, page objects, endpoint clients, tags, execution                         |
| [Locator Intelligence](docs/LOCATOR-INTELLIGENCE.md) | `ui.click`/`ui.fill`, resolution order, confidence levels, self-healing                       |
| [Coverage](docs/COVERAGE.md)                         | Requirement traceability, stable test IDs, pass rate vs. coverage                             |
| [Reporting](docs/REPORTING.md)                       | HTML/JUnit/Allure reports, logs, screenshots/video/trace                                      |
| [Debugging](docs/DEBUGGING.md)                       | Playwright Inspector, trace viewer, headed/debug modes, common failure reads                  |
| [CI/CD](docs/CI-CD.md)                               | GitHub Actions, Jenkins, Azure DevOps                                                         |
| [Docker](docs/DOCKER.md)                             | Building and running the framework in a container                                             |
| [Contributing](docs/CONTRIBUTING.md)                 | Code style, adding page objects/endpoints, commit/PR conventions                              |
| [Troubleshooting](docs/TROUBLESHOOTING.md)           | Known environment quirks and their fixes                                                      |
