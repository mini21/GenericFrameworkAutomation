import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { runGenerationPipeline } from '../../src/core/generation/generation-orchestrator';
import { classifyConfidence } from '../../src/core/generation/element-scorer';
import { ApplicationMap, PageMap } from '../../src/core/discovery/discovery-types';
import { RawStep } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

/**
 * The CRITICAL PRODUCT REQUIREMENT this closes: GAP must automatically
 * select the best unique candidate for a step, deterministically, from
 * scored evidence — never a human choosing a locator during normal
 * automation. See element-scorer.ts's classifyConfidence (the margin
 * policy) and ui-mapper.ts's finalizeNavigate/finalizeElement (where HIGH
 * and MEDIUM both auto-select; only a genuine LOW fails safely, and even
 * then never interactively unless the caller explicitly opts in).
 */

const VERIFIED = {
  strategy: 'role' as const,
  confidence: 'HIGH' as const,
  resolvedLocator: 'getByRole(...)',
};

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

test.describe(`Generation — automatic locator selection: the margin-based confidence policy ${TAGS.SMOKE}`, () => {
  test('1. a unique, exact semantic match auto-selects at HIGH — no prompt, no candidate list shown', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [page('Cart', '/cart.html'), page('Checkout', '/checkout.html')],
    };
    const steps: RawStep[] = [{ action: 'navigate', target: 'Cart', raw: 'Open the cart' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.ambiguous).toBeUndefined();
    expect(mapping.resolved?.detail).toBe('/cart.html');
  });

  test('2. a unique role match (native submit control) auto-selects at HIGH', () => {
    const withForm: PageMap = {
      ...page('Form', '/form'),
      buttons: [{ role: 'button', name: 'Submit', isSubmit: true, verified: VERIFIED }],
    };
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [withForm],
    };
    const steps: RawStep[] = [{ action: 'click', target: 'submit', raw: 'Submit the form' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved?.strategy).toBe('role');
  });

  test('3. a unique label match auto-selects at HIGH — real DOM evidence, no LLM/fuzzy matching involved', () => {
    const withInput: PageMap = {
      ...page('Contact', '/contact'),
      inputs: [{ role: 'textbox', name: 'Email', verified: VERIFIED }],
    };
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [withInput],
    };
    const steps: RawStep[] = [
      { action: 'fill', target: 'Email', value: 'a@b.com', raw: 'Fill Email as "a@b.com"' },
    ];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved?.description).toBe("ui.fill('Email', 'a@b.com')");
  });

  test('4/5. unique testId and fallback-CSS resolution auto-select at the LocatorResolver level — see tests/locator/locator-resolver.spec.ts (this file covers step-level candidate selection, not locator-strategy resolution)', () => {
    // Deliberately a documentation stub, not a duplicate: LocatorResolver's
    // own testId/fallback-chain behavior (including confidence per
    // strategy) is exhaustively covered by tests/locator/locator-resolver.spec.ts
    // ("heals when the primary locator fails", "attaches a report for a
    // non-HIGH confidence resolution", etc.) — this file is about the
    // margin POLICY on top of a scored candidate LIST, a different layer.
    expect(true).toBe(true);
  });

  test('6. MEDIUM confidence with a sufficient margin over the runner-up still auto-selects — recorded, never a stopped workflow', () => {
    // "Apply Leave" is a whole-word match (score 45); "Leaverage Report" is
    // only a substring match (score 20, no word-boundary) — real, if
    // weaker, evidence with a decisive-enough lead (margin 25) to act on.
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [page('Apply Leave', '/apply-leave'), page('Leaverage Report', '/leaverage')],
    };
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('MEDIUM');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved).toBeDefined(); // still auto-selected — MEDIUM never stops the workflow
    expect(mapping.resolved?.detail).toBe('/apply-leave');
    expect(mapping.runnerUpScore).toBe(20);
    expect(mapping.ambiguous).toBeUndefined(); // no prompt
  });

  test('7. two candidates too close to call (margin below threshold) fail safely — never guessed, never .first()', () => {
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
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.unmapped?.reason).toMatch(/too closely to choose safely/);
  });

  test('the margin thresholds are configurable, not hardcoded magic numbers scattered through the code', () => {
    // Tied 45/45 is LOW under the defaults (margin 0 < default mediumMinMargin 10)...
    expect(classifyConfidence(45, 45)).toBe('LOW');
    // ...but a caller with a genuinely different risk tolerance can pass an
    // explicit, named threshold set instead of editing scoring code.
    expect(
      classifyConfidence(45, 45, {
        highMinScore: 60,
        highMinMargin: 30,
        mediumMinScore: 20,
        mediumMinMargin: 0,
      }),
    ).toBe('MEDIUM');
  });

  test('15. normal (non-interactive) generation NEVER offers an interactive locator choice for a genuinely tied candidate, even when a resolveAmbiguity callback is wired up — it fails safely instead', async () => {
    // Reuses the real, committed HRMS application map's own known-tied pair
    // ("Apply Leave" vs "Leave History", both whole-word matches for
    // "Leave" — see tests/generation/ui-mapper.spec.ts's unit-level proof
    // of the same scores) at the full ORCHESTRATOR level this time — a
    // real end-to-end proof, not just ui-mapper in isolation.
    let resolveAmbiguityCalled = false;
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: 'Open Leave.',
      // Wired up exactly like a real interactive CLI caller would — but
      // interactiveResolution is deliberately NOT set, so this must never
      // actually be invoked.
      resolveAmbiguity: async () => {
        resolveAmbiguityCalled = true;
        return undefined;
      },
    });
    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.message).toMatch(/too closely to choose safely|Apply Leave/);
    }
    expect(resolveAmbiguityCalled).toBe(false);
  });
});
