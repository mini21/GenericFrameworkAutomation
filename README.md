# GAP — Generic Automation Platform

Enterprise-grade, **configuration-driven** Test Automation Platform built
on **Playwright + TypeScript**. A QA engineer provides structured
application/environment/module/test-type/browser information — via CLI
flags, a YAML/JSON execution manifest, or a GitHub Actions dropdown — and
GAP resolves it deterministically into native Playwright execution: UI
automation, API automation, Locator Intelligence, requirement coverage,
Allure/HTML/JUnit reporting. No AI/LLM involved anywhere in that path.

> **Status: framework + platform layer complete.** Every layer described
> below is implemented and verified end-to-end, including a full
> reference application (HRMS Leave Management) proving the whole stack
> works, not just the framework in isolation. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what's generic (keep)
> vs. example scaffolding (replace), and
> [docs/PLATFORM.md](docs/PLATFORM.md) for the configuration-driven layer.

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

# Configuration-driven platform layer (see docs/PLATFORM.md):
npm run gap:test -- --application=hrms --environment=qa --type=smoke --browser=chromium
npm run gap:test -- --manifest=config/execution/smoke-hrms-qa.yml
npm run gap:onboard -- --id=<new-app> --name="..." --baseUrl=...

# Natural-language / structured-input interface for Manual QA (see docs/NATURAL-LANGUAGE.md):
npm run gap
# GAP > Run smoke tests for Leave module in QA using Chrome

# Application discovery — map a new application before writing tests (see docs/DISCOVERY.md):
npm run gap:discover -- --application=<new-app> --url=<baseUrl> --start-path=/login.html
```

See [`package.json`](./package.json) for the full script list, or
[docs/TESTING-GUIDE.md](docs/TESTING-GUIDE.md) for a walkthrough of writing
and running tests.

## Project Structure

```
config/             Environment files, applications.json registry, execution manifests
cli/                GAP CLI (gap-test, gap-onboard, gap, gap-discover) — compiled, not Playwright-run
docker/             Dockerfile for containerized execution
docs/               Guides — see Documentation section below
src/core/           Framework internals: fixtures, logger, reporter, http client,
                    db client, browser manager, locator intelligence, coverage,
                    execution resolver, intent parser (natural language/structured
                    input), application discovery, global setup/teardown, utils
src/ui/             Page Objects and Component Objects
src/api/            API endpoint clients
applications/       Per-application code (e.g. hrms/) — isolated from generic core
tests/              Framework-level specs, organized by type (ui / api / e2e / locator / coverage / intent / discovery)
test-data/          Static fixtures, dynamic Faker-based factories, builders
.github/workflows/  GitHub Actions CI (framework CI + GAP manual dispatch)
```

Full rationale for this layout — including what's generic framework code
vs. swappable example scaffolding — is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's implemented

| Layer                 | Where                                                                               | Notes                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Config                | `config/env.config.ts`                                                              | Sole `process.env` reader; typed `AppConfig`; env-file + `.env.local` override                                                |
| Logging               | `src/core/logger/`, `src/core/fixtures/logger.fixture.ts`                           | Winston, console+file, auto-logs test start/finish/failure                                                                    |
| Reporting             | `playwright.config.ts`, `src/core/reporter/`                                        | HTML + JUnit + Allure + custom `SummaryReporter`                                                                              |
| Browser management    | `src/core/browser/browser-manager.ts`                                               | For use outside the standard per-test fixture lifecycle                                                                       |
| API automation        | `src/core/http/`, `src/core/fixtures/api.fixture.ts`                                | `ApiClient` (retry, error handling), schema validation, bearer-token auth                                                     |
| UI automation         | `src/ui/pages/`, `src/core/fixtures/ui.fixture.ts`                                  | Page Object Model, `BasePage`, example pages                                                                                  |
| Auth session reuse    | `src/core/fixtures/auth.fixture.ts`                                                 | Worker-scoped login-once via `storageState`                                                                                   |
| Database              | `src/core/db/`, `src/core/fixtures/db.fixture.ts`                                   | Generic `DbClient` interface + safe in-memory example implementation                                                          |
| Test data             | `test-data/`                                                                        | Static JSON, Faker factories, builders, env-specific data lookup                                                              |
| Locator Intelligence  | `src/core/locator/`, `src/core/fixtures/locator.fixture.ts`                         | `ui.click`/`ui.fill` — deterministic role→label→placeholder→text→testid→css→xpath resolution, confidence levels, self-healing |
| Test Coverage         | `src/core/coverage/`, `tests/coverage/`                                             | Requirement-to-test traceability (not pass-rate-as-coverage); per-application via `GAP_APPLICATION`                           |
| GAP Platform          | `cli/`, `src/core/execution/`, `config/applications.json`                           | Application registry, execution manifests, resolver, CLI — see `docs/PLATFORM.md`                                             |
| Natural Language      | `cli/gap.ts`, `src/core/intent/`, `tests/intent/`                                   | Deterministic NL/structured-input parser → same execution engine, no LLM — see `docs/NATURAL-LANGUAGE.md`                     |
| Application Discovery | `cli/gap-discover.ts`, `src/core/discovery/`, `tests/discovery/`                    | Crawls a new application, reuses the existing LocatorResolver to verify each element — see `docs/DISCOVERY.md`                |
| Reference application | `applications/hrms/`                                                                | HRMS Leave Management — full UI+API stack proving the platform end-to-end                                                     |
| CI/CD                 | `.github/workflows/ci.yml`, `.github/workflows/gap-manual-run.yml`, `docs/CI-CD.md` | GitHub Actions (framework CI + GAP manual dispatch) implemented; Jenkins/Azure DevOps documented                              |
| Docker                | `docker/Dockerfile`, `docker-compose.yml`                                           | Official Playwright base image — browsers preinstalled                                                                        |

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

| Guide                                                | What's in it                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)                 | Design rationale, folder-by-folder reference, execution flow, generic vs. example scaffolding                           |
| [Platform](docs/PLATFORM.md)                         | Application registry, onboarding, execution manifests/resolver, CLI, GitHub Actions/Azure DevOps, reference application |
| [Natural Language](docs/NATURAL-LANGUAGE.md)         | `npm run gap` — natural-language/structured-input execution for Manual QA, ambiguity handling, errors                   |
| [Discovery](docs/DISCOVERY.md)                       | `npm run gap:discover` — crawl a new application into a structured, LocatorResolver-verified Application Map            |
| [Configuration](docs/CONFIGURATION.md)               | Environment variables, secrets handling, adding a new environment                                                       |
| [Testing Guide](docs/TESTING-GUIDE.md)               | Writing UI/API tests, page objects, endpoint clients, tags, execution                                                   |
| [Locator Intelligence](docs/LOCATOR-INTELLIGENCE.md) | `ui.click`/`ui.fill`, resolution order, confidence levels, self-healing                                                 |
| [Coverage](docs/COVERAGE.md)                         | Requirement traceability, stable test IDs, pass rate vs. coverage                                                       |
| [Reporting](docs/REPORTING.md)                       | HTML/JUnit/Allure reports, logs, screenshots/video/trace                                                                |
| [Debugging](docs/DEBUGGING.md)                       | Playwright Inspector, trace viewer, headed/debug modes, common failure reads                                            |
| [CI/CD](docs/CI-CD.md)                               | GitHub Actions, Jenkins, Azure DevOps                                                                                   |
| [Docker](docs/DOCKER.md)                             | Building and running the framework in a container                                                                       |
| [Contributing](docs/CONTRIBUTING.md)                 | Code style, adding page objects/endpoints, commit/PR conventions                                                        |
| [Troubleshooting](docs/TROUBLESHOOTING.md)           | Known environment quirks and their fixes                                                                                |
