# Architecture

This document captures the approved design for the framework — the "why"
behind the folder structure and tooling choices, kept in sync as the
framework evolves.

## Layers

```
Test Layer (tests/)                        specs, tagged, readable by QA
Domain Layer (src/ui, src/api)              Page Objects, Component Objects, API clients
Fixture Layer (src/core/fixtures)           wires domain objects into tests via DI
Core Framework (src/core)                   logger, config, reporter, db, http, utils
Runtime                                     Playwright + Node
```

Playwright's native fixture system (`test.extend` / `mergeTests`) is the backbone — no custom test runner or DSL is layered on top. This keeps the framework idiomatic for anyone who already knows Playwright, and avoids maintaining a bespoke abstraction.

## Generic framework vs. example scaffolding

No real target application, API, or database was available while building
this framework, so every domain-layer example runs against public
scaffolding instead — and is deliberately isolated so it's obvious what to
delete/replace once a real target exists:

| Generic (keep)                                                                       | Example scaffolding (replace)                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/core/**` (config, logger, http client, db interface, fixtures, reporter, utils) | `src/ui/pages/login.page.ts`, `upload.page.ts`, `download.page.ts`, `secure.page.ts` (the-internet.herokuapp.com) |
| `src/ui/pages/base.page.ts`                                                          | `src/api/endpoints/posts.endpoint.ts` (jsonplaceholder.typicode.com)                                              |
| `src/api/http` contract (`ApiClient`, `ApiRequestOptions`, `ApiError`)               | `.env.local` `BASE_URL`/`API_BASE_URL` overrides                                                                  |
| `src/core/db/db-client.ts` `DbClient` interface                                      | `InMemoryDbClient` (swap for `pg`/`mysql2`/... behind the same interface)                                         |
| `test-data/` utilities (`loadStaticData`, `getEnvData`, factories, builders)         | The specific static JSON content and factory field shapes                                                         |
| All of `tests/` as _structure_ (ui/api/e2e, tagging, fixture usage patterns)         | The specific assertions/flows tied to the practice site and test API                                              |

To point the framework at a real target: update
`config/environments/.env.*` (`BASE_URL`, `API_BASE_URL`), delete the
example page objects/endpoint client/specs, and write new ones against the
same `BasePage`/`ApiClient` contracts — no fixture or config plumbing
needs to change.

## Folder Reference

| Folder                                            | Purpose                                                                                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/environments/`                            | One `.env.<env>` file per environment. Only non-secret defaults are committed; real secrets come from CI secret stores or a gitignored `.env.local`.                                                              |
| `config/env.config.ts`                            | Sole reader of `process.env`. Resolves `ENV`, loads the matching file, validates required keys, exports a typed `AppConfig` (base/API URLs, log level, optional API auth token, optional DB connection settings). |
| `src/core/fixtures/`                              | All dependency injection: `logger`, `api`, `db`, `ui`, `auth` — one file per concern, merged once into `base.fixture.ts`, which specs import.                                                                     |
| `src/core/logger/`                                | Centralized Winston logger (console + file transport) used by every framework layer — no stray `console.log`.                                                                                                     |
| `src/core/reporter/`                              | `SummaryReporter` — routes test failures through the centralized logger, alongside the native HTML/JUnit/Allure reporters.                                                                                        |
| `src/core/http/`                                  | `ApiClient`: thin wrapper over Playwright's `APIRequestContext` with logging, retry-on-5xx, and `ApiError`. `response-assertions.ts` adds status/schema validation helpers.                                       |
| `src/core/db/`                                    | Generic `DbClient` interface (connect/insert/find/findOne/clear/disconnect) for test data setup/verification/cleanup, plus a safe in-memory example implementation.                                               |
| `src/core/utils/`                                 | Stateless helpers (date, wait/retry, file I/O, network mocking, screenshots) with no framework or config knowledge.                                                                                               |
| `src/core/global-setup.ts` / `global-teardown.ts` | Run once per full test run (not per worker) — logs run start/end against the resolved environment.                                                                                                                |
| `src/core/browser/browser-manager.ts`             | Launches/manages browsers outside the standard per-test fixture lifecycle (e.g. custom scripts).                                                                                                                  |
| `src/core/types/`                                 | Shared TypeScript types/interfaces.                                                                                                                                                                               |
| `src/ui/pages/`                                   | Page Object Model — one class per page/screen. `base.page.ts` holds shared navigation/wait behavior.                                                                                                              |
| `src/ui/components/`                              | Component Object Model — reusable UI fragments (header, nav, modals). Empty until a target app has shared fragments worth extracting; the pattern is documented here for when it does.                            |
| `src/api/endpoints/`                              | One module per API resource, wrapping `core/http` with typed request/response shapes — the API equivalent of Page Objects.                                                                                        |
| `tests/`                                          | Specs only, split by type (`ui/`, `api/`, `e2e/`), tagged (`@smoke`, `@regression`, `@e2e`) for selective execution via `--grep`. No locators or raw HTTP calls here.                                             |
| `test-data/static/`                               | Checked-in reference data that doesn't change per run (JSON).                                                                                                                                                     |
| `test-data/factories/`                            | Faker-based factories and fluent builders generating unique data per test — required for safe parallel execution.                                                                                                 |
| `test-data/utils/`                                | `loadStaticData()` (generic JSON loader) and `getEnvData()` (environment-specific data lookup) — kept out of `src/` since they're test-data concerns, not framework internals.                                    |
| `docker/Dockerfile`, `docker-compose.yml`         | Containerized execution target, ensuring local/CI parity.                                                                                                                                                         |
| `.github/workflows/ci.yml`                        | GitHub Actions CI (lint/typecheck gate, smoke on every PR, matrix regression on main). Jenkins/Azure DevOps equivalents documented in `docs/CI-CD.md`.                                                            |

## Execution Flow

1. Invocation: `ENV=qa npm run test:ui -- --grep @smoke`
2. `playwright.config.ts` imports `config/env.config.ts`, which loads and validates the matching `.env.<env>` file, then registers `global-setup.ts`/`global-teardown.ts`.
3. Playwright spawns workers per the configured `projects` (browser matrix + `api` project) and `workers` setting.
4. Fixtures resolve per test: requesting `{ loginPage }` triggers browser context + page object creation; `{ api }` gets a worker-scoped `APIRequestContext` wrapped in `ApiClient`; `{ db }` gets a fresh test-scoped `DbClient`; `{ authenticatedPage }` reuses a worker-scoped cached login session.
5. Test body calls only into page/API/DB objects — never Playwright APIs or `core/` internals directly (network mocking via `page.route` and file upload/download via native Playwright APIs are the exceptions, used directly in specs since they're one-off native capabilities, not domain objects).
6. Fixture teardown runs automatically (context close, DB disconnect) — no manual `afterEach`.
7. Reporters (HTML, JUnit, Allure, SummaryReporter) write results during the run; failures auto-attach screenshots, traces, video, and correlated logs (`logs/run.log`).

## Fixture Strategy

- Fixtures are split by concern (`logger`, `api`, `db`, `ui`, `auth`) and merged once in `base.fixture.ts` via `mergeTests` so specs always import a single `test` object.
- Scoping discipline: expensive/shareable resources (`apiRequestContext`, the cached auth `storageStatePath`) are **worker**-scoped; anything requiring isolation (browser context/page, page objects, `db`) is **test**-scoped. `db` is test-scoped rather than worker-scoped specifically because `InMemoryDbClient` has no expensive connection to amortize — sharing it across tests in a worker would leak data between them for no performance benefit.
- Cross-cutting concerns (start/end/failure logging) are auto-fixtures — no per-spec opt-in required.

## Test Data Strategy

- Static data (`test-data/static/`) for stable reference data, loaded via `loadStaticData()`.
- Dynamic data (`test-data/factories/`) via Faker factories and builders, guaranteeing uniqueness under parallel execution.
- Environment-specific expected values via `getEnvData()`, keyed by the resolved `ENV`.
- Data created during a test is cleaned up by the fixture that created it (e.g. `db` fixture disconnects/clears on teardown).
- Nothing environment-specific is hardcoded in specs or factories — that comes from `config`.

## Reporting & Logging Strategy

- **Playwright HTML** for local/debug use.
- **Allure** for enterprise trend reporting and stakeholder dashboards (note: `allure-playwright` v3's config key is `resultsDir`, not the v2-era `outputFolder` — see `docs/TROUBLESHOOTING.md`).
- **JUnit XML** for native CI test-result panels (Jenkins, Azure DevOps).
- **SummaryReporter** (custom): routes pass/fail summary and failure details through the centralized logger, so failures show up in `logs/run.log` alongside everything else.
- **Winston** logger, console + file transport, level controlled by `LOG_LEVEL`; failure logs are attached alongside report artifacts.

## Key Design Decisions

| Decision                                                   | Rationale                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright fixtures over custom hooks                      | Idiomatic, typed, lower learning curve than a bespoke DI layer.                                                                                                                                                                      |
| Built-in `APIRequestContext` over Axios                    | One HTTP engine; shares session/cookies with UI context when needed; fewer dependencies.                                                                                                                                             |
| Config module as sole `process.env` reader                 | Prevents env-var access sprawl; enables fail-fast validation at one point.                                                                                                                                                           |
| Worker-scoped auth fixture                                 | Logging in per test is slow and unrealistic; session reuse mirrors real usage and cuts run time.                                                                                                                                     |
| Allure + HTML + JUnit + custom SummaryReporter             | Each CI platform consumes results differently; the custom reporter is the one thing native reporters don't do — route failures through the app's own logger.                                                                         |
| Component Object Model alongside Page Object Model         | Avoids duplicating locators for shared UI fragments across pages, once a target app has any.                                                                                                                                         |
| Faker-based factories + builders over static-only data     | Static data collides under parallel execution; factories/builders guarantee uniqueness and readable overrides.                                                                                                                       |
| In-memory `DbClient` example over a real driver            | No target database exists yet; a real driver would need a real connection/credentials/Docker service just to exercise scaffolding code. The generic interface makes swapping in `pg`/`mysql2` later a drop-in change, not a rewrite. |
| Public practice site/API as UI/API scaffolding             | Same reasoning as the DB choice — proves every layer works end-to-end without inventing a fake target that would need to be thrown away anyway. Isolated per the table above.                                                        |
| Docker as execution target                                 | Local/CI/any-platform parity from one Dockerfile, pinned to the official Playwright image matching the installed `@playwright/test` version.                                                                                         |
| GitHub Actions matrix for regression, single job for smoke | Smoke needs to be fast (one job, two projects) for PR feedback; regression needs full coverage, so each project gets its own parallel CI job.                                                                                        |
| No custom test runner/DSL                                  | Playwright's runner, `--grep` tagging, and `projects` already cover requirements.                                                                                                                                                    |
