# Application Discovery (Phase 1 POC)

Before writing a single test for a new application, GAP can crawl it and
produce an **Application Map** — what pages exist, what's on each one
(buttons, links, inputs, selects, checkboxes, tables, forms, navigation),
and which of those elements are actually, uniquely clickable/fillable
right now. No test code is generated at this stage — this is a reviewable
artifact for a human, and later phases' input.

```bash
npm run gap:discover -- --application=hrms --url=http://localhost:4100 --start-path=/login.html
```

```
GAP: discovering "hrms" at http://localhost:4100
GAP: crawling up to 15 same-origin page(s), starting at /login.html

Application: hrms

Pages:
  HRMS Login
    - Username
    - Password
    - Login

1 page(s) mapped.
GAP: application map written to applications/hrms/discovery/application-map.json
```

## What this is — and isn't

Discovery reuses the **existing** Locator Intelligence system — it doesn't
invent a second one. Every button/link/checkbox/input name found is
re-verified live, through the same `LocatorResolver` that `ui.click`/
`ui.fill` use at test time, so a name in the map that carries a `verified`
block is _proven_ uniquely resolvable, not just "seen" in the page.

```
--url, --storage-state, --start-path
   ↓
chromium (launched directly — see below)
   ↓
Locator.ariaSnapshot() per page   ← native Playwright, no new dependency
   ↓
LocatorResolver.resolve()         ← the EXISTING resolver, reused as-is
   ↓
applications/<id>/discovery/application-map.json
```

No code generation, no LLM, and no changes to the execution engine,
coverage, or reporting — this only produces a JSON file plus a printed
summary.

## Authentication: bring your own `storageState`

Discovery does **not** attempt to detect or fill an arbitrary login form —
that's too fragile to be a safe default. Instead, pass an already-
authenticated Playwright `storageState` file, the same mechanism
[`auth.fixture.ts`](../src/core/fixtures/auth.fixture.ts) already uses to
cache sessions:

```bash
npx playwright codegen --save-storage=/tmp/my-app-state.json http://localhost:4100
# log in manually in the window that opens, then close it
npm run gap:discover -- --application=hrms --url=http://localhost:4100 \
  --start-path=/dashboard.html --storage-state=/tmp/my-app-state.json
```

Without `--storage-state`, discovery runs unauthenticated — useful for
mapping a login page itself, or any public pages, before you have a
session to reuse.

**Never pass credentials as CLI flags** — a username/password on the
command line leaks into shell history and the process list. `--storage-
state` avoids that; discovery has no `--username`/`--password` flags at
all, on purpose.

## Crawl scope (defaults)

- **Same-origin only.** A link to any other host/port is never followed —
  the only domain a discovery run ever touches is the one in `--url`.
- **Capped at 15 pages** by default (`--max-pages`) — a shallow breadth-
  first crawl, not an exhaustive site walk.
- Non-page links are skipped: `mailto:`/`tel:`/`javascript:` targets and
  common download extensions (`.pdf`, `.zip`, `.csv`, images, video).
- A page that fails to load is recorded under `errors` in the map and the
  crawl continues — one broken page doesn't abort the whole run.

## Flags

| Flag              | Required | Default             | Meaning                                                        |
| ----------------- | -------- | ------------------- | -------------------------------------------------------------- |
| `--application`   | yes      | —                   | Application id — output goes to `applications/<id>/discovery/` |
| `--url`           | yes      | —                   | Base URL to crawl                                              |
| `--start-path`    | no       | `/`                 | First page to visit                                            |
| `--storage-state` | no       | _(unauthenticated)_ | Path to a Playwright `storageState` JSON file                  |
| `--max-pages`     | no       | `15`                | Same-origin page cap                                           |
| `--headless`      | no       | `true`              | Pass `--headless=false` to watch the crawl                     |

## Reading the output

`applications/<id>/discovery/application-map.json` — one entry per page:

- `pageName`/`title`/`headings` — how to identify the page
- `buttons`/`links`/`inputs`/`selects`/`checkboxes` — each with `role`/
  `name`, plus a `verified` block (`strategy`, `confidence`,
  `resolvedLocator`) for anything actually re-checked through
  `LocatorResolver` — absent means it wasn't uniquely/usably resolvable at
  scan time (duplicate name, hidden, disabled, or a `<select>`, which
  isn't verified since neither click nor fill fits it)
- `tables`/`forms`/`navigation` — landmark counts (most are unnamed in the
  accessibility tree, so they're counted, not itemized by name)
- `testIds` — `data-testid` attributes present on the page, capped at 20
- `ariaSnapshot` — the raw Playwright accessibility snapshot for the page,
  kept for debugging/future use

## Scope

This is Phase 1 only: discovery and mapping. It does **not** generate
requirements, test specifications, or Playwright code — those are future
phases, deliberately not built yet. See the architecture note in
`src/core/discovery/` for how a later generation phase would plug in
without a second execution engine: it would consume this JSON and the
existing `LocatorResolver`/execution engine, the same way discovery does.
