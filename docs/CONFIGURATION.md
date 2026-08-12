# Configuration

## How environment selection works

`config/env.config.ts` is the single place that reads `process.env`. It:

1. Resolves `ENV` (`dev` | `qa` | `staging` | `prod`), defaulting to `qa`.
2. Loads `config/environments/.env.<ENV>`.
3. Optionally loads a gitignored `.env.local` at the repo root, which **overrides** anything from the environment file — this is where local secrets go.
4. Validates that required keys are present, failing fast with a clear error if not.
5. Exports a typed `AppConfig` object consumed by `playwright.config.ts` and (eventually) fixtures.

Nothing else in the framework should read `process.env` directly — import `config` from `config/env.config.ts` instead.

## Selecting an environment

```bash
ENV=dev npm test
ENV=staging npm run test:ui
```

If `ENV` is omitted, `qa` is used.

## Variables

| Variable                                                      | Required                | Description                                                                                                                             |
| ------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ENV`                                                         | No (defaults to `qa`)   | Which environment file to load.                                                                                                         |
| `BASE_URL`                                                    | Yes                     | Base URL for UI navigation (`playwright.config.ts` → `use.baseURL`).                                                                    |
| `API_BASE_URL`                                                | Yes                     | Base URL for API calls.                                                                                                                 |
| `LOG_LEVEL`                                                   | No (defaults to `info`) | Winston log level: `error` \| `warn` \| `info` \| `debug`.                                                                              |
| `AUTH_USERNAME` / `AUTH_PASSWORD`                             | Project-dependent       | Example placeholders for the auth fixture (not yet implemented).                                                                        |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | No                      | Unused by the default in-memory `DbClient`; populate once a real driver (pg, mysql2, ...) replaces it — see `src/core/db/db-client.ts`. |
| `API_AUTH_TOKEN`                                              | No                      | Bearer token attached to every API request when set; leave empty for public/unauthenticated APIs.                                       |

See [`.env.example`](../.env.example) for the full template.

## Secrets handling

- `config/environments/.env.*` files are committed and must **only** contain non-secret values (URLs, log level, feature flags).
- Real credentials/connection strings are supplied two ways:
  - **Locally**: create a `.env.local` at the repo root (gitignored) with the real values; it overrides the committed env file.
  - **CI**: inject as environment variables via the platform's secret store (GitHub Actions Secrets, Jenkins Credentials, Azure DevOps Variable Groups) — never written to a file in the repo.
- `.env`, `.env.local`, and `.env.*.local` are all gitignored as a safety net.

## Adding a new environment

1. Create `config/environments/.env.<name>` with at least `BASE_URL` and `API_BASE_URL`.
2. Add `<name>` to the `VALID_ENVIRONMENTS` array in `config/env.config.ts`.
3. Run with `ENV=<name> npm test`.
