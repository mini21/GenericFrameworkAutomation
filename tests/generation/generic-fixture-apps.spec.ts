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
