import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { parseRequirement } from '../../src/core/generation/requirement-parser';
import {
  runGenerationPipeline,
  rejectGeneration,
} from '../../src/core/generation/generation-orchestrator';
import { requirementInputFor } from '../../src/core/generation/requirement-input';
import { ApplicationMap, PageMap } from '../../src/core/discovery/discovery-types';
import { RawStep } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

/**
 * Incremental, state-aware step planning — the fixes for the Amazon
 * end-to-end blockers reported after the first automatic-locator-selection
 * pass: a Requirement sentence getting parsed as an executable step, a
 * "Search for a product" step with nowhere to get a concrete value from, and
 * every step past the first live/dynamic action failing because resolution
 * only ever looked at the ONE static discovery-time snapshot instead of
 * deferring to a live, "rediscover the current page" runtime resolution.
 */

function page(pageName: string, path: string): PageMap {
  return {
    path,
    url: `http://localhost:9999${path}`,
    title: pageName,
    pageName,
    headings: [],
    buttons: [],
    links: [],
    inputs: [],
    selects: [],
    checkboxes: [],
    tables: 0,
    forms: 0,
    navigation: 0,
    testIds: [],
    confirmationRegions: [],
    ariaSnapshot: '',
  };
}

const VERIFIED = {
  strategy: 'role' as const,
  confidence: 'HIGH' as const,
  resolvedLocator: 'getByRole(...)',
};

test.describe(`Incremental discovery & entity-tracked step planning ${TAGS.SMOKE}`, () => {
  // ---------------------------------------------------------------------
  // 1. Requirement is not treated as an executable step
  // ---------------------------------------------------------------------
  test('1. a business-intent Requirement sentence starting with "Verify" is never parsed as an executable step when Test Steps are supplied separately', () => {
    const { requirementText, businessRequirement } = requirementInputFor(
      'Verify that a user can search for a product, view the search results, select a product, ' +
        'open the product details page, add the selected product to the cart, open the cart, and ' +
        'verify that the selected product is present in the cart.',
      'Open Amazon.\nSearch for a product.\nVerify search results are displayed.',
    );
    expect(businessRequirement).toMatch(/^Verify that a user can search/);
    // The parseable text is ONLY the Test Steps — the Requirement sentence
    // never becomes step 1.
    const parsed = parseRequirement(requirementText);
    expect(parsed.steps.map((s) => s.action)).toEqual(['navigate', 'fill', 'click', 'verify']);
    expect(parsed.steps.every((s) => s.raw !== businessRequirement)).toBe(true);
  });

  test('1b. with Test Steps left blank, the natural-language-only flow is unchanged — the Requirement text itself is what gets parsed', () => {
    const { requirementText, businessRequirement } = requirementInputFor(
      'Login as employee. Open Apply Leave.',
      '',
    );
    expect(businessRequirement).toBeUndefined();
    expect(requirementText).toBe('Login as employee. Open Apply Leave.');
  });

  test('1c. end to end via the real orchestrator: the saved spec displays the Requirement, but the Requirement sentence never appears among the resolved/mapped steps', async () => {
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: 'Login as employee.\nOpen Apply Leave.',
      businessRequirement:
        'Verify that an employee can log in and open the apply-leave page for a valid request.',
    });
    if (outcome.status !== 'ready-for-approval') {
      throw new Error(`expected ready-for-approval, got blocked: ${JSON.stringify(outcome)}`);
    }
    expect(outcome.spec.requirementText).toBe(
      'Verify that an employee can log in and open the apply-leave page for a valid request.',
    );
    expect(outcome.spec.steps).toHaveLength(2);
    expect(outcome.spec.steps.every((s) => s.step.action !== 'verify')).toBe(true);
    rejectGeneration(outcome); // never save a test this spec didn't explicitly approve
  });

  // ---------------------------------------------------------------------
  // 2. Search step obtains its value from the test-data profile
  // ---------------------------------------------------------------------
  test('2. "Search for a product" resolves its value from the application data profile FIRST — never invented, never hardcoded in core', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          ...page('Home', '/'),
          inputs: [{ role: 'searchbox', name: 'Search', verified: VERIFIED }],
          buttons: [{ role: 'button', name: 'Search', isSubmit: true, verified: VERIFIED }],
        },
      ],
    };
    const steps = parseRequirement('Search for a product.').steps;
    const mappings = mapRequirementToUI('genericapp', map, steps, {
      dataProfile: { product: { searchTerm: 'wireless mouse' } },
    });
    expect(mappings[0].resolved?.description).toBe("ui.fill('Search', 'wireless mouse')");
  });

  test('2b. falls back to the discovered entity catalog when the data profile has nothing for that noun — never a crash, never invented', () => {
    const withCatalog: PageMap = {
      ...page('Home', '/'),
      inputs: [{ role: 'searchbox', name: 'Search', verified: VERIFIED }],
      buttons: [{ role: 'button', name: 'Search', isSubmit: true, verified: VERIFIED }],
      entities: [{ entityType: 'product', name: 'Catalog Item' }],
    };
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [withCatalog],
    };
    const steps = parseRequirement('Search for a product.').steps;
    const mappings = mapRequirementToUI('genericapp', map, steps, { dataProfile: {} });
    expect(mappings[0].resolved?.description).toBe("ui.fill('Search', 'Catalog Item')");
  });

  test('2c. with NEITHER a data profile entry NOR a discovered catalog, fails safely with a clear, actionable reason — never guessed', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          ...page('Home', '/'),
          inputs: [{ role: 'searchbox', name: 'Search', verified: VERIFIED }],
          buttons: [{ role: 'button', name: 'Search', isSubmit: true, verified: VERIFIED }],
        },
      ],
    };
    const steps = parseRequirement('Search for a product.').steps;
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('LOW');
    expect(mapping.unmapped?.reason).toContain('test-data profile');
    expect(mapping.unmapped?.reason).toContain('product');
  });

  // ---------------------------------------------------------------------
  // 3/8. Rediscovery: a step following an unknown/dynamic page context
  // defers to LIVE resolution instead of using stale/wrong static evidence
  // ---------------------------------------------------------------------
  test('3. a click step immediately after an entity is opened (unknown destination) defers entirely to runtime resolution — never scored against stale/wrong static evidence', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [{ ...page('Home', '/'), entities: [] }], // nothing statically known — the live results/details page was never crawled
    };
    const steps: RawStep[] = [
      { action: 'select-entity', target: 'product', raw: 'Select a product' },
      { action: 'open-entity', target: 'product', raw: 'Open the product details page' },
      { action: 'click', target: 'Add to Cart', raw: 'Add the product to the cart' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings.every((m) => m.confidence === 'HIGH')).toBe(true);
    expect(mappings.every((m) => m.decision === 'AUTO_SELECTED')).toBe(true);
    expect(mappings[2].resolved?.kind).toBe('click');
    expect(mappings[2].resolved?.description).toBe("ui.click('Add to Cart')");
    expect(mappings[2].diagnostics[0].reasons[0]).toMatch(/no static discovery evidence/);
    // No LocatorResolver strategy/confidence was pre-decided at generation
    // time — the whole point is that it's resolved live, at test-run time.
    expect(mappings[2].resolved?.strategy).toBeUndefined();
  });

  test('8. "Open the cart" with ZERO static evidence anywhere in the discovered map degrades to a live, generic click — never a locator prompt, never an outright failure over an incomplete crawl', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [page('Home', '/'), page('Contact', '/contact')], // no page/link named "cart" anywhere
    };
    const steps = parseRequirement('Open the cart.').steps;
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved?.kind).toBe('deferred-navigate'); // degraded from navigate -> a role-scoped live link click
    expect(mapping.resolved?.description).toBe("page.getByRole('link', { name: 'cart' }).click()");
    expect(mapping.ambiguous).toBeUndefined();
  });

  test('8b. real, if weak/ambiguous, static evidence for a navigate target is NOT discarded in favor of the runtime degrade — the existing margin-based safe-failure policy still applies', () => {
    // Two pages both plausibly named "Leave" (a REAL tie, not "nothing at
    // all") — must still fail safely via the existing policy, not silently
    // degrade to a generic live click that could land on either.
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [page('Apply Leave', '/apply-leave'), page('Leave History', '/leave-history')],
    };
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('LOW');
    expect(mapping.decision).toBe('SAFE_FAILURE');
    expect(mapping.diagnostics.length).toBe(2); // real evidence was used, not discarded
    expect(mapping.resolved).toBeUndefined();
  });
});
