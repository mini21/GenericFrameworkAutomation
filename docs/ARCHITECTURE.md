# Architecture

This document captures the approved design for the framework — the "why" behind the folder structure and tooling choices, kept in sync as the framework evolves.

## Layers

```
Test Layer (tests/)                        specs, tagged, readable by QA
Domain Layer (src/ui, src/api)              Page Objects, Component Objects, API clients
Fixture Layer (src/core/fixtures)           wires domain objects into tests via DI
Core Framework (src/core)                   logger, config, reporter, db, http, utils
Runtime                                     Playwright + Node
```

Playwright's native fixture system (`test.extend` / `mergeTests`) is the backbone — no custom test runner or DSL is layered on top. This keeps the framework idiomatic for anyone who already knows Playwright, and avoids maintaining a bespoke abstraction.

## Folder Reference

| Folder                                                     | Purpose                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/environments/`                                     | One `.env.<env>` file per environment. Only non-secret defaults are committed; real secrets come from CI secret stores or a gitignored `.env.local`.                             |
| `config/env.config.ts`                                     | Sole reader of `process.env`. Resolves `ENV`, loads the matching file, validates required keys, exports a typed `AppConfig`.                                                     |
| `src/core/fixtures/`                                       | All dependency injection. One file per concern (`ui`, `api`, `auth`, `db`); `base.fixture.ts` merges them into the `test` object specs import.                                   |
| `src/core/logger/`                                         | Centralized Winston logger used by every framework layer — no stray `console.log`.                                                                                               |
| `src/core/reporter/`                                       | Custom Playwright reporter for anything native reporters (HTML/JUnit/Allure) don't cover, e.g. attaching logs to failed tests.                                                   |
| `src/core/http/`                                           | Thin wrapper over Playwright's built-in `APIRequestContext` (base URL, default headers, request/response logging). This is the API automation engine — no separate HTTP library. |
| `src/core/db/`                                             | Database client wrapper for test data setup/verification/cleanup.                                                                                                                |
| `src/core/utils/`                                          | Stateless helpers (date, wait/retry, file I/O) with no framework or config knowledge.                                                                                            |
| `src/core/types/`                                          | Shared TypeScript types/interfaces.                                                                                                                                              |
| `src/ui/pages/`                                            | Page Object Model — one class per page/screen. `base.page.ts` holds shared navigation/wait behavior.                                                                             |
| `src/ui/components/`                                       | Component Object Model — reusable UI fragments (header, nav, modals) composed into page objects, avoiding locator duplication.                                                   |
| `src/api/endpoints/`                                       | One module per API resource, wrapping `core/http` with typed request/response shapes — the API equivalent of Page Objects.                                                       |
| `tests/`                                                   | Specs only, split by type (`ui/`, `api/`, `e2e/`), tagged (`@smoke`, `@regression`) for selective execution via `--grep`. No locators or raw HTTP calls here.                    |
| `test-data/static/`                                        | Checked-in reference data that doesn't change per run.                                                                                                                           |
| `test-data/factories/`                                     | Faker-based builders generating unique data per test — required for safe parallel execution.                                                                                     |
| `docker/`                                                  | Containerized execution target, ensuring local/CI parity.                                                                                                                        |
| `.github/workflows/`, `Jenkinsfile`, `azure-pipelines.yml` | CI definitions per platform, each invoking the same `npm run test:*` scripts.                                                                                                    |

## Execution Flow

1. Invocation: `ENV=qa npm run test:ui -- --grep @smoke`
2. `playwright.config.ts` imports `config/env.config.ts`, which loads and validates the matching `.env.<env>` file.
3. Playwright spawns workers per the configured `projects` (browser matrix) and `workers` setting.
4. Fixtures resolve per test: requesting `{ loginPage }` triggers browser context + page object creation; an authenticated test additionally reuses a worker-scoped cached login session.
5. Test body calls only into page/API/DB objects — never Playwright APIs or `core/` internals directly.
6. Fixture teardown runs automatically (context close, data cleanup) — no manual `afterEach`.
7. Reporters (HTML, JUnit, Allure) write results during the run; failures auto-attach screenshots, traces, video, and correlated logs.

## Fixture Strategy

- Fixtures are split by concern and merged once in `base.fixture.ts` so specs always import a single `test` object.
- Scoping discipline: expensive/shareable resources (DB pool, auth session) are **worker**-scoped; anything requiring isolation (browser context, test data) is **test**-scoped.
- Cross-cutting concerns (start/end logging, trace attachment) are auto-fixtures — no per-spec opt-in required.

## Test Data Strategy

- Static data (`test-data/static/`) for stable reference data.
- Dynamic data (`test-data/factories/`) via Faker, guaranteeing uniqueness under parallel execution.
- Data created during a test is cleaned up by the fixture that created it.
- Nothing environment-specific is hardcoded in specs or factories — that comes from `config`.

## Reporting & Logging Strategy

- **Playwright HTML** for local/debug use.
- **Allure** for enterprise trend reporting and stakeholder dashboards.
- **JUnit XML** for native CI test-result panels (Jenkins, Azure DevOps).
- **Winston** logger, console + file transport, level controlled by `LOG_LEVEL`; failure logs are attached alongside report artifacts.

## Key Design Decisions

| Decision                                           | Rationale                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Playwright fixtures over custom hooks              | Idiomatic, typed, lower learning curve than a bespoke DI layer.                                            |
| Built-in `APIRequestContext` over Axios            | One HTTP engine; shares session/cookies with UI context when needed; fewer dependencies.                   |
| Config module as sole `process.env` reader         | Prevents env-var access sprawl; enables fail-fast validation at one point.                                 |
| Worker-scoped auth fixture                         | Logging in per test is slow and unrealistic; session reuse mirrors real usage and cuts run time.           |
| Allure + HTML + JUnit together                     | Each CI platform consumes results differently; JUnit needs zero custom scripting for Jenkins/Azure DevOps. |
| Component Object Model alongside Page Object Model | Avoids duplicating locators for shared UI fragments across pages.                                          |
| Faker-based factories over static-only data        | Static data collides under parallel execution; factories guarantee uniqueness.                             |
| Docker as execution target                         | Local/CI/any-platform parity from one Dockerfile.                                                          |
| No custom test runner/DSL                          | Playwright's runner, `--grep` tagging, and `projects` already cover requirements.                          |
