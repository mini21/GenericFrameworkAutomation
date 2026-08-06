# Test Automation Framework

Enterprise-grade, generic Test Automation Framework built on **Playwright + TypeScript**, supporting UI automation, API automation, cross-browser execution, multi-environment configuration, parallel execution, and tagged test runs.

> **Status: Skeleton stage.** Folder structure, tooling, and configuration are in place. Fixtures, page objects, API clients, and specs are not yet implemented — see [Roadmap](#roadmap).

## Prerequisites

- Node.js >= 18
- npm >= 10

## Getting Started

```bash
npm install
npx playwright install --with-deps   # download browser binaries
cp .env.example .env.local            # optional: local secret overrides
```

Once specs exist, run:

```bash
npm test                 # full suite, ENV=qa
npm run test:ui          # UI specs only
npm run test:api         # API specs only
npm run test:smoke       # tests tagged @smoke
npm run test:dev         # run against the dev environment
```

See [`package.json`](./package.json) for the full script list.

## Project Structure

```
config/            Environment files (.env.<env>) and the typed config loader
src/core/          Framework internals: fixtures, logger, reporter, http client, db client, utils, types
src/ui/            Page Objects and Component Objects
src/api/           API endpoint clients
tests/             Specs, organized by type (ui / api / e2e)
test-data/         Static fixtures and dynamic data factories
docker/            Containerized execution setup
.github/workflows/ GitHub Actions CI
```

Full rationale for this layout is in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Configuration & Environments

Environment is selected via the `ENV` variable (`dev` | `qa` | `staging` | `prod`, defaults to `qa`):

```bash
ENV=staging npm test
```

Details on required variables and secret handling: [docs/CONFIGURATION.md](./docs/CONFIGURATION.md).

## Tooling

| Concern     | Tool                                                              |
| ----------- | ----------------------------------------------------------------- |
| Test runner | Playwright Test                                                   |
| Language    | TypeScript                                                        |
| Linting     | ESLint (flat config) + typescript-eslint                          |
| Formatting  | Prettier                                                          |
| Git hooks   | Husky + lint-staged (runs lint/format on staged files pre-commit) |
| Reporting   | Playwright HTML, JUnit XML, Allure                                |
| Logging     | Winston                                                           |
| Test data   | Static JSON + Faker-based factories                               |

```bash
npm run lint          # check
npm run lint:fix       # check + fix
npm run format          # write formatting
npm run format:check   # check only
npm run typecheck      # tsc --noEmit
```

### Enabling git hooks

This workspace isn't a git repository yet. Once you run `git init`, hooks activate automatically on the next `npm install` (via the `prepare` script), or run manually:

```bash
git init
npm install
```

## Roadmap

The following are designed (see `docs/ARCHITECTURE.md`) but intentionally not yet implemented, pending explicit approval per stage:

- Core fixtures (`ui`, `api`, `auth`, `db`) and their composition in `base.fixture.ts`
- Logger implementation (Winston setup)
- API client wrapper and first endpoint clients
- Database client utilities
- First Page Objects / Component Objects and example specs
- Dockerfile and docker-compose for containerized runs
- GitHub Actions workflow, Jenkinsfile, Azure DevOps pipeline

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — design rationale, folder-by-folder explanation, execution flow
- [Configuration](./docs/CONFIGURATION.md) — environment variables, secrets handling
