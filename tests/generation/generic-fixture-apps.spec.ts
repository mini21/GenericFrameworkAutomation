import { chromium, Browser, BrowserContext } from 'playwright';
import * as http from 'http';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';
import { crawlApplication } from '../../src/core/discovery/site-crawler';
import { establishAuthenticatedStart } from '../../src/core/discovery/authenticated-start';
import { PageMap } from '../../src/core/discovery/discovery-types';
import { ApplicationMap } from '../../src/core/discovery/discovery-types';
import { parseRequirement } from '../../src/core/generation/requirement-parser';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { generateSpecFile } from '../../src/core/generation/code-generator';
import {
  registerApplication,
  unregisterApplication,
} from '../../src/core/config/application-registry';
import { createApp as createAdminPanel } from '../../applications/adminpanel/server/app';
import { createApp as createStorefront } from '../../applications/storefront/server/app';

/**
 * The REAL, generic capability suite — genuine synthetic applications
 * (never Amazon, never HRMS), crawled through the REAL discovery pipeline
 * (`crawlApplication`/`mapPage`, real Playwright navigation against a real
 * running server), then run through the REAL requirement parser and UI
 * mapper. No hand-built ApplicationMap objects here — this is what proves
 * the engine is generic, not merely unit-tested against fixtures shaped to
 * fit its own code. Per the product direction: whenever a real-application
 * failure (Amazon or otherwise) surfaces a missing generic capability, the
 * fix AND the regression proof both belong here, not as another Amazon
 * patch.
 */

let adminServer: http.Server;
let storefrontServer: http.Server;
let adminBaseUrl: string;
let storefrontBaseUrl: string;
let browser: Browser;
let context: BrowserContext;
let adminMap: ApplicationMap;
let storefrontMap: ApplicationMap;
let adminLoginPage: PageMap;

// Port 0 (OS-assigned, ephemeral) — this file's tests run across several
// concurrent Playwright workers (fullyParallel), and each worker gets its
// own beforeAll invocation; a fixed port would collide the moment more
// than one worker's beforeAll tried to bind it at once.
function listenEphemeral(app: import('express').Express): { server: http.Server; baseUrl: string } {
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, baseUrl: `http://localhost:${port}` };
}

test.beforeAll(async () => {
  ({ server: adminServer, baseUrl: adminBaseUrl } = listenEphemeral(createAdminPanel()));
  ({ server: storefrontServer, baseUrl: storefrontBaseUrl } = listenEphemeral(createStorefront()));
  // Defensive — a previous crashed run could have left these registered;
  // unregisterApplication is a no-op when the id isn't present.
  unregisterApplication('genericfixture-adminpanel');
  unregisterApplication('genericfixture-storefront');
  registerApplication('genericfixture-adminpanel', {
    name: 'AdminPanel',
    baseUrl: adminBaseUrl,
    modules: [],
    authProfiles: [],
    defaultBrowser: 'chromium',
    supportedBrowsers: ['chromium'],
    dataProfiles: ['qa-default'],
    startPath: '/login.html',
  });
  registerApplication('genericfixture-storefront', {
    name: 'Storefront',
    baseUrl: storefrontBaseUrl,
    modules: [],
    authProfiles: [],
    defaultBrowser: 'chromium',
    supportedBrowsers: ['chromium'],
    dataProfiles: ['qa-default'],
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();

  // AdminPanel's dashboard/users/create pages are only ever reachable via
  // a client-side redirect AFTER a real login — no static <a href> from
  // the login page reaches them, exactly like a real authenticated app.
  // Uses the EXISTING generic authenticated-discovery mechanism
  // (authenticated-start.ts) — the same one runGenerationPipeline's own
  // loadOrDiscoverMap already uses for any application with a registered
  // credential — not a special path invented for this test.
  const probePage = await context.newPage();
  await probePage.goto(new URL('/login.html', adminBaseUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  const authenticated = await establishAuthenticatedStart(probePage, {
    username: 'admin',
    password: 'Admin123!',
  });
  await probePage.close();
  expect(authenticated).toBeDefined();
  adminLoginPage = authenticated!.loginPage;

  adminMap = await crawlApplication(context, {
    application: 'genericfixture-adminpanel',
    baseUrl: adminBaseUrl,
    startPath: authenticated?.path ?? '/login.html',
    maxPages: 15,
  });
  // Mirrors generation-orchestrator.ts's loadOrDiscoverMap: the BFS above
  // resumes from the AUTHENTICATED path and never revisits the login page
  // itself, so it has to be spliced back in explicitly for a "Login as X"
  // step to have anything to resolve against.
  if (!adminMap.pages.some((p) => p.path === adminLoginPage.path)) {
    adminMap.pages.unshift(adminLoginPage);
  }
  storefrontMap = await crawlApplication(context, {
    application: 'genericfixture-storefront',
    baseUrl: storefrontBaseUrl,
    startPath: '/',
    maxPages: 15,
  });
});

test.afterAll(async () => {
  await context.close();
  await browser.close();
  unregisterApplication('genericfixture-adminpanel');
  unregisterApplication('genericfixture-storefront');
  await new Promise((resolve) => adminServer.close(resolve));
  await new Promise((resolve) => storefrontServer.close(resolve));
});

test.describe(`Generation — generic synthetic-application capability suite ${TAGS.SMOKE}`, () => {
  test('1/2. discovery finds a real login form and a real search form on two unrelated apps', () => {
    expect(adminLoginPage.inputs.map((i) => i.name).sort()).toEqual(['Password', 'Username']);
    expect(adminLoginPage.buttons.map((b) => b.name)).toContain('Log In');

    const home = storefrontMap.pages.find((p) => p.path === '/');
    expect(home?.inputs.some((i) => i.name === 'Search' && i.role === 'searchbox')).toBe(true);
    expect(home?.buttons.some((b) => b.name === 'Search' && b.isSubmit)).toBe(true);
  });

  test('9. static product cards/lists are discoverable without any submit', () => {
    const products = storefrontMap.pages.find((p) => p.path === '/products.html');
    expect(products?.headings).toContain('Products');
  });

  test('11. a redirecting legacy URL is followed to its real destination without crashing discovery', async () => {
    const redirectMap = await crawlApplication(context, {
      application: 'genericfixture-storefront',
      baseUrl: storefrontBaseUrl,
      startPath: '/old-home.html',
      maxPages: 5,
    });
    expect(redirectMap.errors).toEqual([]);
    expect(redirectMap.pages.length).toBeGreaterThan(0);
    expect(redirectMap.pages[0].pageName).toBe('Storefront');
  });

  test('14. same text, different element types (link "Search" vs button "Search" vs input "Search") never confuses action-capability resolution', () => {
    const home = storefrontMap.pages.find((p) => p.path === '/');
    expect(home?.links.some((l) => l.name === 'Search')).toBe(true);
    expect(home?.buttons.some((b) => b.name === 'Search')).toBe(true);
    expect(home?.inputs.some((i) => i.name === 'Search')).toBe(true);

    const fillMapping = mapRequirementToUI('genericfixture-storefront', storefrontMap, [
      { action: 'fill', target: 'Search', value: 'mouse', raw: 'Enter "mouse" in the search box' },
    ])[0];
    expect(fillMapping.resolved?.kind).toBe('fill');

    const submitMapping = mapRequirementToUI('genericfixture-storefront', storefrontMap, [
      { action: 'click', target: 'submit', raw: 'Submit the search' },
    ])[0];
    expect(submitMapping.resolved?.kind).toBe('click');
    expect(submitMapping.resolved?.description).toBe("ui.click('Search')");
    // Never the nav link — only the real submit control has isSubmit.
    expect(submitMapping.diagnostics.every((d) => d.elementType !== 'link' || !d.selected)).toBe(
      true,
    );
  });

  test('1, 6, 15, 16, 17. full search -> submit -> content-assertion workflow, end to end, through the real crawled map', () => {
    const requirement =
      'User should be able to search for a product.\n' +
      'Enter "Mouse" in the search box.\n' +
      'Submit the search.\n' +
      'Verify that search results are displayed.';
    const parsed = parseRequirement(requirement);
    expect(parsed.steps.map((s) => s.action)).toEqual(['fill', 'click', 'verify']);

    const mappings = mapRequirementToUI('genericfixture-storefront', storefrontMap, parsed.steps);
    expect(mappings.every((m) => m.confidence === 'HIGH')).toBe(true);

    expect(mappings[0].resolved?.description).toBe("ui.fill('Search', 'Mouse')");
    // 16. the submit resolves against the form's real native submit
    // control (isSubmit), never a text-similarity fallback against the
    // same-named nav link.
    expect(mappings[1].resolved?.description).toBe("ui.click('Search')");
    expect(mappings[1].resolved?.strategy).toBe('role');

    // 6. the results page is never statically discoverable (it only
    // exists after a real submit) — the CONTENT-assertion resolver uses
    // the preceding fill step's own value as evidence instead, never an
    // ARIA status/alert region for a content-shaped assertion.
    expect(mappings[2].resolved?.kind).toBe('verify');
    expect(mappings[2].resolved?.strategy).toBe('text');
    expect(mappings[2].resolved?.description).toContain('Mouse');
  });

  test('4. two forms on one page sharing an identically-named Submit button are individuated with real form identity', () => {
    const contact = storefrontMap.pages.find((p) => p.path === '/contact.html');
    const submits = contact?.buttons.filter((b) => b.name === 'Submit') ?? [];
    expect(submits).toHaveLength(2);
    expect(submits.map((s) => s.formLabel).sort()).toEqual(['Sales form', 'Support form']);
    expect(submits.every((s) => s.verified)).toBe(true);
  });

  test('checkbox (Subscribe to newsletter) is discovered and resolvable as a CHECK action on a real server', () => {
    const contact = storefrontMap.pages.find((p) => p.path === '/contact.html');
    expect(contact?.checkboxes.some((c) => c.name === 'Subscribe to newsletter')).toBe(true);

    const mapping = mapRequirementToUI('genericfixture-storefront', storefrontMap, [
      { action: 'navigate', target: 'Contact', raw: 'Open Contact' },
      {
        action: 'check',
        target: 'Subscribe to newsletter',
        raw: 'Check the Subscribe to newsletter checkbox',
      },
    ])[1];
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved?.kind).toBe('check');
  });

  test('select (Role dropdown) is discovered and resolvable as a SELECT action on a real server', () => {
    const createUserPage = adminMap.pages.find((p) => p.path === '/users/create.html');
    expect(createUserPage?.selects.some((s) => s.name === 'Role')).toBe(true);
    expect(createUserPage?.selects.find((s) => s.name === 'Role')?.verified).toBeDefined();
  });

  test('7/8. success/error notification regions are discovered generically (ARIA status/alert, no app-specific wording)', () => {
    const contact = storefrontMap.pages.find((p) => p.path === '/contact.html');
    expect(contact?.confirmationRegions.map((r) => r.role).sort()).toEqual(['alert', 'status']);

    const createUserPage = adminMap.pages.find((p) => p.path === '/users/create.html');
    expect(createUserPage?.confirmationRegions.map((r) => r.role).sort()).toEqual([
      'alert',
      'status',
    ]);
  });

  test('full Admin -> Users -> Create User workflow generates a fully-mapped, executable spec against the real crawled map', () => {
    const requirement =
      'Admin should be able to create a new user.\n' +
      'Login as admin.\n' +
      'Open Users.\n' +
      'Click Add User.\n' +
      'Fill Name as "Jamie Test".\n' +
      'Fill Email as "jamie@example.com".\n' +
      'Select "Editor" for Role.\n' +
      'Submit the request.\n' +
      'Verify that the user was created.';
    const parsed = parseRequirement(requirement);
    expect(parsed.needsClarification).toEqual([]);
    expect(parsed.steps.map((s) => s.action)).toEqual([
      'login',
      'navigate',
      'click',
      'fill',
      'fill',
      'select',
      'click',
      'verify',
    ]);

    const mappings = mapRequirementToUI('genericfixture-adminpanel', adminMap, parsed.steps);
    const unmapped = mappings.filter((m) => m.unmapped);
    const ambiguous = mappings.filter((m) => m.ambiguous);
    expect(unmapped).toEqual([]);
    expect(ambiguous).toEqual([]);
    expect(mappings.every((m) => m.confidence === 'HIGH')).toBe(true);

    const spec = {
      requirementId: 'GENERIC-001',
      requirementText: requirement,
      testName: 'admin can create a new user',
      application: 'genericfixture-adminpanel',
      module: 'users',
      type: 'functional' as const,
      preconditions: [],
      expectedResults: [],
      steps: mappings,
    };
    const { code } = generateSpecFile(spec);
    expect(code).toContain('await ui.selectOption("Role", "Editor");');
    expect(code).toContain('ui.click(');
  });
});

test.describe(`Generation — automatic locator selection + entity tracking ${TAGS.SMOKE}`, () => {
  test('"Select a product" deterministically picks the first discovered entity — pure bookkeeping, no UI action of its own', () => {
    const steps = parseRequirement('Select a product.').steps;
    expect(steps).toEqual([
      { action: 'select-entity', target: 'product', raw: 'Select a product' },
    ]);

    const [mapping] = mapRequirementToUI('genericfixture-storefront', storefrontMap, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved?.kind).toBe('select-entity');
    expect(mapping.resolved?.detail).toBe('product'); // entity-type noun — the REAL discovery (data-entity or a structural fallback) happens live at runtime, see entity-discovery.ts
    // Deterministic — the FIRST discovered "product" item, document order —
    // never random, never a guessed business value.
    expect(mapping.diagnostics[0].label).toBe('Wireless Mouse');
    expect(mapping.diagnostics[0].selected).toBe(true);
  });

  test('"Open the product details page" and "Add the product to the cart" resolve deterministically from the selected entity — no re-matching by name', () => {
    const requirement =
      'Select a product.\n' + 'Open the product details page.\n' + 'Add the product to the cart.';
    const parsed = parseRequirement(requirement);
    expect(parsed.steps.map((s) => s.action)).toEqual(['select-entity', 'open-entity', 'click']);
    // "Add the product to the cart" decomposes into an ORDINARY click
    // target via the generic "Add to <Container>" English convention — no
    // new step kind needed for it.
    expect(parsed.steps[2].target).toBe('Add to Cart');

    const mappings = mapRequirementToUI('genericfixture-storefront', storefrontMap, parsed.steps);
    expect(mappings.every((m) => m.confidence === 'HIGH')).toBe(true);
    expect(mappings[1].resolved?.kind).toBe('open-entity');
    expect(mappings[2].resolved?.kind).toBe('click');
    expect(mappings[2].resolved?.description).toBe("ui.click('Add to Cart')");
  });

  test('"Open the cart" resolves via ordinary page-name matching — no entity involvement needed', () => {
    const steps = parseRequirement('Open the cart.').steps;
    const [mapping] = mapRequirementToUI('genericfixture-storefront', storefrontMap, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved?.kind).toBe('navigate');
    expect(mapping.resolved?.detail).toBe('/cart.html');
  });

  test('"Verify the selected product is present in the cart" uses the runtime-captured entity name via the {{entity:selected}} marker, never a re-guessed literal', () => {
    const requirement = 'Select a product.\nVerify the selected product is present in the cart.';
    const steps = parseRequirement(requirement).steps;
    const mappings = mapRequirementToUI('genericfixture-storefront', storefrontMap, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.kind).toBe('verify');
    expect(mappings[1].resolved?.detail).toBe('{{entity:selected}}');
    expect(mappings[1].resolved?.description).toContain('selectedEntityName');
  });

  test('a verify step naming "selected" content with no preceding select-entity step is honestly reported unmapped, never guessed', () => {
    const steps = parseRequirement('Verify the selected product is present in the cart.').steps;
    const [mapping] = mapRequirementToUI('genericfixture-storefront', storefrontMap, steps);
    expect(mapping.confidence).toBe('LOW');
    expect(mapping.unmapped).toBeDefined();
  });

  test('FULL acceptance flow: search -> results -> select -> details -> add to cart -> open cart -> verify, entirely auto-resolved end to end through the real crawled map, zero interactive prompts, generates a real executable spec', () => {
    const requirement =
      'User should be able to search for a product, view results, select it, open its details, ' +
      'add it to the cart, and verify it in the cart.\n' +
      'Search for a product.\n' +
      'Verify that search results are displayed.\n' +
      'Select a product.\n' +
      'Open the product details page.\n' +
      'Add the product to the cart.\n' +
      'Open the cart.\n' +
      'Verify the selected product is present in the cart.';
    const parsed = parseRequirement(requirement);
    expect(parsed.needsClarification).toEqual([]);
    expect(parsed.steps.map((s) => s.action)).toEqual([
      'fill', // Search for a product (value derived from the discovered catalog)
      'click', // submit the search
      'verify', // search results are displayed
      'select-entity', // Select a product
      'open-entity', // Open the product details page
      'click', // Add the product to the cart
      'navigate', // Open the cart
      'verify', // Verify the selected product is present in the cart
    ]);

    const mappings = mapRequirementToUI('genericfixture-storefront', storefrontMap, parsed.steps);
    const unmapped = mappings.filter((m) => m.unmapped);
    const ambiguous = mappings.filter((m) => m.ambiguous);
    expect(unmapped).toEqual([]);
    // NEVER interactive during normal (non-interactive, default) resolution
    // — the core product requirement this whole suite closes.
    expect(ambiguous).toEqual([]);
    expect(mappings.every((m) => m.confidence === 'HIGH')).toBe(true);
    expect(mappings.every((m) => m.decision === undefined || m.decision === 'AUTO_SELECTED')).toBe(
      true,
    );

    const spec = {
      requirementId: 'GENERIC-002',
      requirementText: requirement,
      testName: 'user can search select and add a product to the cart',
      application: 'genericfixture-storefront',
      module: 'shopping',
      type: 'functional' as const,
      preconditions: [],
      expectedResults: [],
      steps: mappings,
    };
    const { code } = generateSpecFile(spec);
    // Real UI abstraction for every ordinary step — never a raw
    // page.locator standing in for a fill/click GAP already knows how to
    // express generically.
    expect(code).toContain('await ui.fill("Search"');
    expect(code).toContain('await ui.click("Add to Cart")');
    // Entity tracking's runtime capture — the one deliberate, necessary
    // exception (no ui.selectEntity() abstraction exists — see the
    // implementation report's limitations) — fully self-contained/declared,
    // never a generation-time string literal standing in for a live
    // selection.
    expect(code).toContain('let selectedEntityLocator: Locator;');
    expect(code).toContain('selectedEntityLocator = await selectEntity(page, "product");');
    expect(code).toContain(
      "import { selectEntity } from '../../../../../src/core/discovery/entity-discovery';",
    );
    // The final cart-presence assertion reads the RUNTIME-captured variable
    // — never a generation-time string literal standing in for a live
    // selection (only the earlier, independent search-term fill legitimately
    // bakes in a literal, derived from the same discovered catalog).
    expect(code).toContain('getByText(selectedEntityName)');
  });

  test('RUNTIME PROOF: the same flow actually executes correctly against the live server — real search, real data-entity click, real cart persistence', async ({
    page,
  }) => {
    await page.goto(storefrontBaseUrl + '/');
    await page.getByRole('searchbox', { name: 'Search' }).fill('Wireless Mouse');
    await page.getByRole('button', { name: 'Search' }).click();

    // The live search-results state is what select-entity's runtime locator
    // actually resolves against (never the static discovery-time snapshot,
    // which is empty for this page — see collectEntityItems' comment).
    const resultEntity = page.locator('[data-entity="product"]').first();
    await expect(resultEntity).toBeVisible();
    const name = (await resultEntity.textContent())?.trim();
    expect(name).toBe('Wireless Mouse');

    const urlBefore = page.url();
    await resultEntity.click();
    await page.waitForURL((url) => url.toString() !== urlBefore);
    await expect(page.getByRole('heading', { name: 'Wireless Mouse' })).toBeVisible();

    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(page.getByRole('status')).toHaveText('Added to cart');

    await page.goto(storefrontBaseUrl + '/cart.html');
    await expect(page.getByText(name!)).toBeVisible();
  });

  test('RESILIENCE PROOF: the DEFERRED runtime resolution (used when a step\'s page is only known live — root cause 1/3) genuinely works against a live page GAP\'s static discovery never saw — exactly the "Add the product to the cart" / "Open the cart" mechanism', async ({
    page,
    ui,
  }) => {
    // Simulates arriving at a product-details page and needing to act on
    // it with ZERO prior static knowledge — the exact situation
    // ui-mapper.ts's deferredElementResolution hands off to at codegen
    // time (see incremental-planning.spec.ts for the analysis-time proof
    // that this hand-off actually happens). This test proves the
    // RUNTIME half: the SAME ui.click(...) mechanism every generated
    // test already uses resolves correctly with no page-map assistance
    // at all, live, via LocatorResolver.
    await page.goto(storefrontBaseUrl + '/product/p1.html'); // arrived here with no preceding discovery of this page
    await ui.click('Add to Cart');
    await expect(page.getByRole('status')).toHaveText('Added to cart');

    // "Open the cart" degraded from navigate -> a role-SCOPED live link
    // click (see ui-mapper.ts's deferredElementResolution/code-generator.ts's
    // 'deferred-navigate' case) — deliberately narrower than a plain
    // deferred ui.click('cart') would be: this same page ALSO has an
    // "Add to Cart" BUTTON whose name contains "cart" as a substring,
    // which a full multi-role chain would find first (button before
    // link) and wrongly click again. Scoping to role=link is what makes
    // this resolve the real Cart nav link instead.
    const urlBeforeOpen = page.url();
    await page.getByRole('link', { name: 'cart' }).click();
    await page.waitForURL((url) => url.toString() !== urlBeforeOpen);
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(page.getByText('Wireless Mouse')).toBeVisible();
  });
});
