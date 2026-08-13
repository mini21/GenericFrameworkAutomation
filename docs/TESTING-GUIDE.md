# Testing Guide

How to write and run tests in this framework. Written for QA engineers —
assumes familiarity with Playwright's `test`/`expect` but not with this
repo's conventions.

## The golden rule

Specs never call Playwright APIs or `core/` internals directly for
UI/API/DB work — they call into **page objects**, **endpoint clients**, and
the **`db` fixture**. The two exceptions are native, one-off Playwright
capabilities with no domain meaning to wrap: `page.route()` for network
mocking and `page.setInputFiles()`/`page.waitForEvent('download')` for
file transfer — see `tests/ui/network-mocking.spec.ts`,
`tests/ui/upload.spec.ts`, `tests/ui/download.spec.ts`.

Always import `test`/`expect` from the single composed fixture file, never
from an individual fixture module or from `@playwright/test` directly:

```ts
import { test, expect } from '../../src/core/fixtures/base.fixture';
```

## Writing a UI test

1. If the page doesn't have a page object yet, add one under `src/ui/pages/`, extending `BasePage`:

   ```ts
   import { Page } from '@playwright/test';
   import { BasePage } from './base.page';

   export class MyPage extends BasePage {
     private readonly someButton = '#some-button';

     constructor(page: Page) {
       super(page);
     }

     async open(): Promise<void> {
       await this.goto('/my-page');
     }

     async clickSomeButton(): Promise<void> {
       await this.page.click(this.someButton);
     }
   }
   ```

2. Register it as a fixture in `src/core/fixtures/ui.fixture.ts`:

   ```ts
   myPage: async ({ page }, use) => {
     await use(new MyPage(page));
   },
   ```

3. Use it in a spec under `tests/ui/` or `tests/e2e/`:

   ```ts
   import { test, expect } from '../../src/core/fixtures/base.fixture';
   import { TAGS } from '../../src/core/constants';

   test(`does the thing ${TAGS.SMOKE}`, async ({ myPage }) => {
     await myPage.open();
     await myPage.clickSomeButton();
     // ...
   });
   ```

See `src/ui/pages/login.page.ts` + `tests/ui/login.spec.ts` for a complete
worked example.

## Writing an API test

1. Add an endpoint client under `src/api/endpoints/`, wrapping `ApiClient`:

   ```ts
   import { APIResponse } from '@playwright/test';
   import { ApiClient, ApiRequestOptions } from '../../core/http/api-client';

   export class UsersApi {
     constructor(private readonly client: ApiClient) {}

     getById(id: number, options: ApiRequestOptions = {}): Promise<APIResponse> {
       return this.client.get(`/users/${id}`, options);
     }
   }
   ```

2. Use it in a spec under `tests/api/`, via the `api` fixture:

   ```ts
   import { test, expect } from '../../src/core/fixtures/base.fixture';
   import { UsersApi } from '../../src/api/endpoints/users.endpoint';
   import { expectStatus, assertSchema } from '../../src/core/http/response-assertions';

   test('fetches a user', async ({ api }) => {
     const usersApi = new UsersApi(api);
     const response = await usersApi.getById(1);
     await expectStatus(response, 200);

     const user = await response.json();
     assertSchema(user, { id: 'number', name: 'string', email: 'string' });
   });
   ```

`ApiClient` methods (`get`/`post`/`put`/`patch`/`delete`) all accept
`{ retries, retryDelayMs }` for retry-on-5xx, and any per-request
`headers`/`params`/`data` — see `src/core/http/api-client.ts` and the
worked examples in `tests/api/posts.spec.ts`.

## Using the DB fixture

`db` (from `src/core/fixtures/db.fixture.ts`) is test-scoped — a fresh
`DbClient` per test, connected/disconnected automatically, so one test's
data never leaks into another's:

```ts
test('reads back inserted data', async ({ db }) => {
  await db.insert('users', { id: 1, email: 'a@example.com' });
  const row = await db.findOne('users', (r) => r.email === 'a@example.com');
  expect(row?.id).toBe(1);
});
```

The default `DbClient` is an in-memory example (see
`docs/ARCHITECTURE.md`) — swap it for a real driver behind the same
interface once a target database exists.

## Using Locator Intelligence (the `ui` fixture)

For elements you don't have (or don't want) a page-object locator for,
`ui.click(name)`/`ui.fill(name, value)` resolves through Playwright's own
recommended locators (role → label → placeholder → text → testId → css →
xpath) automatically:

```ts
test('logs in', async ({ ui }) => {
  await ui.fill('Username', 'john');
  await ui.fill('Password', 'secret');
  await ui.click('Login');
});
```

Full resolution order, confidence levels, self-healing, and reporting
behavior: [docs/LOCATOR-INTELLIGENCE.md](./LOCATOR-INTELLIGENCE.md). This
is a separate, independent fixture from the page-object `loginPage`/etc.
fixtures above — use whichever fits: page objects for stable, reused flows;
`ui` for one-off interactions or elements not worth a dedicated locator.

## Test data

- Static reference data: `test-data/static/*.json`, loaded via `loadStaticData<T>('file.json')`.
- Dynamic/unique data: factories in `test-data/factories/` (e.g. `createUser()`), or fluent builders (e.g. `new PostBuilder().withTitle('...').build()`).
- Environment-specific expected values: `getEnvData<T>()`, keyed by the resolved `ENV`.
- Parameterize a test over static data by looping and calling `test()` inside the loop — see `tests/api/posts-data-driven.spec.ts`. This is plain Playwright, no special helper needed.

## Tags

Defined in `src/core/constants/tags.ts`: `@smoke`, `@regression`, `@ui`,
`@api`, `@e2e`. Append to the test title string; select via `--grep`:

```ts
test(`creates a post ${TAGS.REGRESSION}`, async ({ api }) => {
  /* ... */
});
```

```bash
npx playwright test --grep @smoke
npm run test:smoke        # equivalent npm script
npm run test:regression
```

### Stable test IDs for requirement coverage

Separate from the `@smoke`/`@regression` title tags above, a test that
automates a tracked requirement gets a structured, title-independent `tag`
via Playwright's native option:

```ts
test(
  'logs in with valid credentials @smoke',
  { tag: ['@auth.login.valid'] },
  async ({ loginPage }) => {
    /* ... */
  },
);
```

This is purely additive metadata (doesn't change what the test does), and
is what `test-data/static/requirements.json` maps against. See
[docs/COVERAGE.md](./COVERAGE.md) for the full model — when to add one,
how coverage is calculated, and how it differs from pass rate.

## Running tests

```bash
npm test                        # everything, ENV=qa
npm run test:ui                 # tests/ui only
npm run test:api                # tests/api only
npm run test:smoke              # @smoke across all projects
npm run test:regression         # @regression across all projects
npm run test:headed             # headed browser (see what's happening)
npm run test:debug              # Playwright Inspector — see docs/DEBUGGING.md
ENV=staging npm test            # against a different environment
npx playwright test --project=chromium tests/ui/login.spec.ts   # one file, one browser
```

Projects: `chromium`, `firefox`, `webkit` (UI/e2e/locator specs — API and
coverage specs are excluded via `testIgnore`), `api` (API specs only, no
browser launched), and `coverage` (the coverage report generator, no
browser). See `playwright.config.ts`.
