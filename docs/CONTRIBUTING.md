# Contributing

## Before you start

Read [docs/ARCHITECTURE.md](./ARCHITECTURE.md), specifically the "Generic
framework vs. example scaffolding" section — know which files you're
extending (generic, careful) vs. replacing (example, freely deletable).

## Code style

Enforced automatically, not a matter of taste:

```bash
npm run lint       # ESLint (flat config, typescript-eslint recommended)
npm run format     # Prettier
npm run typecheck  # tsc --noEmit, strict mode
```

A Husky pre-commit hook runs `lint-staged` (ESLint + Prettier on staged
files) automatically — fix issues it reports rather than bypassing with
`--no-verify`.

Conventions already in place, follow them:

- No `console.log` — use the shared `logger` (`src/core/logger/logger.ts`).
- No direct `process.env` access outside `config/env.config.ts`.
- Specs never call `page`/`APIRequestContext`/DB internals directly except for the documented native-API exceptions (network mocking, file upload/download) — go through page objects, endpoint clients, or the `db` fixture.
- No comments explaining _what_ code does — only _why_, when non-obvious.

## Adding a page object / endpoint client

See [docs/TESTING-GUIDE.md](./TESTING-GUIDE.md) — "Writing a UI test" /
"Writing an API test" walk through the exact steps (page object → fixture
registration → spec).

## Adding a new environment

1. `config/environments/.env.<name>` with at least `BASE_URL` and `API_BASE_URL`.
2. Add `<name>` to `VALID_ENVIRONMENTS` in `config/env.config.ts`.
3. Run with `ENV=<name> npm test`.

## Commit and PR conventions

- Commit messages: imperative, present tense ("Add", not "Added"), explain
  _why_ over _what_ when the diff alone doesn't make it obvious.
- One logical change per commit — don't bundle an unrelated formatting pass
  into a feature commit.
- Run the full validation pass before opening a PR:

  ```bash
  npm run lint && npm run typecheck && npm run format:check && npm test
  ```

- If you touch `playwright.config.ts`, `docker/Dockerfile`, or
  `.github/workflows/ci.yml`, actually run the thing (`npm test` /
  `docker compose build` / validate the workflow YAML) — these are exactly
  the files where a typo silently breaks CI for everyone.

## Replacing the example scaffolding with a real target

1. Update `config/environments/.env.*` (`BASE_URL`, `API_BASE_URL`).
2. Delete `src/ui/pages/{login,secure,upload,download}.page.ts` and
   `src/api/endpoints/posts.endpoint.ts`; write real ones against the same
   `BasePage`/`ApiClient` base classes.
3. Delete/replace the example specs under `tests/ui/`, `tests/api/`,
   `tests/e2e/` that reference the deleted page objects/endpoint client.
4. Update `.env.local` (local) and CI env vars (`.github/workflows/ci.yml`,
   or your Jenkins/Azure DevOps config per `docs/CI-CD.md`) to match.
5. Everything else — fixtures, config loader, reporters, logger, DB layer —
   needs no changes.
