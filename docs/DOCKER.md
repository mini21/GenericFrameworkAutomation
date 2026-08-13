# Docker

## Build and run

```bash
docker compose build

BASE_URL=https://the-internet.herokuapp.com \
API_BASE_URL=https://jsonplaceholder.typicode.com \
  docker compose run --rm tests

# or the full suite with the image's default CMD:
BASE_URL=https://the-internet.herokuapp.com \
API_BASE_URL=https://jsonplaceholder.typicode.com \
  docker compose up --build
```

`BASE_URL`/`API_BASE_URL`/`API_AUTH_TOKEN`/`ENV` are passed through as
container environment variables (see `docker-compose.yml`) — the same
precedence rule applies as everywhere else: an explicitly-set env var wins
over the committed `.env.<env>` placeholder (`config/env.config.ts`).
`.env.local` is **not** copied into the image (excluded via
`.dockerignore`, since it's gitignored and may hold local secrets) — pass
real values as container env vars or Docker secrets instead.

Reports are bind-mounted back to the host:

```bash
ls reports/html-report/   # populated on the host after the container run
```

## Run a specific subset

```bash
docker compose run --rm tests npx playwright test --grep @smoke --project=chromium --project=api
docker compose run --rm tests npx playwright test tests/api
```

## Why the official Playwright image

`docker/Dockerfile` builds on `mcr.microsoft.com/playwright:v1.62.1-jammy`
— **the version tag must match the installed `@playwright/test` version**
in `package.json`/`package-lock.json` (currently 1.62.1), or you'll hit
"browser not found"-type errors from a version-mismatched browser binary.
Update both together when bumping Playwright.

Using this base image means all OS-level browser dependencies
(fonts, codecs, etc.) are already installed — no `playwright install
--with-deps` step needed inside the container, unlike a bare `node:*` image.

## Cleaning up

```bash
docker compose down
docker image rm genericframework-tests   # or whatever `docker compose images` shows
```

## CI usage

The same image is referenced in the Jenkins example in
[docs/CI-CD.md](./CI-CD.md) — GitHub Actions instead installs browsers
directly on the runner (`playwright install --with-deps`) since spinning up
a container-in-container adds complexity without benefit there.
