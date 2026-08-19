import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { ApplicationMap, PageMap } from '../../src/core/discovery/discovery-types';
import { RawStep } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';
import {
  registerApplication,
  unregisterApplication,
} from '../../src/core/config/application-registry';

// Reproduces the reported class of bug generically — an identically-named
// control ("Search") repeated verbatim across several pages, the way a
// site-wide header search box appears on every page of a real e-commerce
// site. Nothing here is Amazon-specific: any application with a shared
// header/nav control hits the same shape. Three pages each carry their OWN
// "Search" input and "Search" button, all scored identically by name alone
// — the only thing that can tell them apart is which page a PRECEDING
// step's own resolved element came from.
const VERIFIED = {
  strategy: 'role' as const,
  confidence: 'HIGH' as const,
  resolvedLocator: 'getByRole(...)',
};

// Every page carries an identically-named "Search" button (the site-wide
// header control) — but only the Home page also has the "Search" INPUT,
// exactly like a real site where a search box lives on one page while its
// icon-button counterpart is repeated in the header everywhere.
function searchPage(pageName: string, path: string, withInput: boolean): PageMap {
  return {
    path,
    url: `http://localhost:9999${path}`,
    title: pageName,
    pageName,
    headings: [],
    buttons: [{ role: 'button', name: 'Search', verified: VERIFIED }],
    links: [],
    inputs: withInput ? [{ role: 'textbox', name: 'Search', verified: VERIFIED }] : [],
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

const MAP: ApplicationMap = {
  application: 'genericapp',
  baseUrl: 'http://localhost:9999',
  generatedAt: '2026-01-01T00:00:00.000Z',
  errors: [],
  pages: [
    searchPage('Home', '/', true),
    searchPage('Category', '/category', false),
    searchPage('Results', '/results', false),
  ],
};

test.describe(`Generation — contextual candidate ranking ${TAGS.SMOKE}`, () => {
  test('1. same text on multiple pages, no preceding step to give context, is genuinely ambiguous', () => {
    const steps: RawStep[] = [{ action: 'click', target: 'Search', raw: 'Submit the search' }];
    const [mapping] = mapRequirementToUI('genericapp', MAP, steps);
    expect(mapping.confidence).toBe('MEDIUM');
    expect(mapping.ambiguous?.candidates.length).toBe(3);
  });

  test('2. same button text repeated within a single page stays ambiguous even with page context established — the context bonus narrows to a page, not within it', () => {
    const dupPage: PageMap = {
      ...searchPage('Two Forms', '/two-forms', true),
      buttons: [
        { role: 'button', name: 'Search', verified: VERIFIED },
        // A second, unrelated control that happens to share the exact same name
        // (e.g. two independent search widgets in different regions of one page).
        {
          role: 'button',
          name: 'Search',
          verified: { ...VERIFIED, resolvedLocator: 'getByTestId(2)' },
        },
      ],
    };
    const map: ApplicationMap = { ...MAP, pages: [dupPage] };
    const steps: RawStep[] = [
      {
        action: 'fill',
        target: 'Search',
        value: 'laptop',
        raw: 'Enter "laptop" in the search box',
      },
      { action: 'click', target: 'Search', raw: 'Submit the search' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[0].confidence).toBe('HIGH'); // the fill resolves fine — only one input named "Search"
    expect(mappings[1].confidence).toBe('MEDIUM');
    expect(mappings[1].ambiguous?.candidates.length).toBe(2);
  });

  test('3. an input followed by a submit action: the submit resolves against the SAME page the input was found on, not a copy on another page', () => {
    const steps: RawStep[] = [
      {
        action: 'fill',
        target: 'Search',
        value: 'laptop',
        raw: 'Enter "laptop" in the search box',
      },
      { action: 'click', target: 'Search', raw: 'Submit the search' },
    ];
    const mappings = mapRequirementToUI('genericapp', MAP, steps);

    expect(mappings[0].confidence).toBe('HIGH');
    expect(mappings[0].resolved?.description).toBe("ui.fill('Search', 'laptop')");

    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.description).toBe("ui.click('Search')");
    expect(
      mappings[1].diagnostics.some((d) => d.reasons.some((r) => r.includes('same page'))),
    ).toBe(true);
  });

  test('4. genuinely ambiguous candidates are reported, never silently guessed or suppressed', () => {
    const steps: RawStep[] = [{ action: 'click', target: 'Search', raw: 'Submit the search' }];
    const [mapping] = mapRequirementToUI('genericapp', MAP, steps);
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.ambiguous).toBeDefined();
    expect(mapping.ambiguous?.candidates.map((c) => c.label)).toEqual([
      'Search',
      'Search',
      'Search',
    ]);
  });

  test('5. the exact same ambiguous step becomes uniquely resolvable once a preceding step supplies page context', () => {
    const ambiguousAlone: RawStep[] = [
      { action: 'click', target: 'Search', raw: 'Submit the search' },
    ];
    const [withoutContext] = mapRequirementToUI('genericapp', MAP, ambiguousAlone);
    expect(withoutContext.confidence).toBe('MEDIUM');

    const withPrecedingFill: RawStep[] = [
      {
        action: 'fill',
        target: 'Search',
        value: 'laptop',
        raw: 'Enter "laptop" in the search box',
      },
      { action: 'click', target: 'Search', raw: 'Submit the search' },
    ];
    const mappings = mapRequirementToUI('genericapp', MAP, withPrecedingFill);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
    expect(mappings[1].diagnostics.find((d) => d.selected)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Reproduces the EXACT reported defect: a real, non-technical requirement
// ("Enter "laptop" in the search box.") whose target text ("search box")
// never literally appears in any real accessible name (nobody names a
// control "Search box" — see element-scorer.ts's stripTrailingWidgetWord),
// combined with a site-wide control repeated identically across many
// pages, produced a 5-identical-candidate question a Manual QA could not
// reasonably answer. Fixed generically: (1) a target's trailing generic
// widget word ("box"/"field"/"button"/...) is stripped before matching —
// applies to ANY app/domain, no fixed vocabulary; (2) the FIRST fill/click
// step (no preceding step yet) gets a scoring bonus for a candidate on the
// application's own configured start page — the exact page the generated
// test's own prepended page.goto() actually lands on. Nothing here is
// Amazon-specific: a registered "gap-test-*" fixture app stands in.
// ---------------------------------------------------------------------------
function cleanUpApp(id: string): void {
  unregisterApplication(id);
  const appDir = path.resolve(process.cwd(), 'applications', id);
  if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
}

test.describe.configure({ mode: 'serial' });

test.describe(`Generation — contextual candidate ranking, reported defect ${TAGS.SMOKE}`, () => {
  test('a natural-language "the X box" target resolves against a real accessible name that never contains the word "box"', () => {
    const map: ApplicationMap = {
      application: 'x',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [searchPage('Home', '/', true)],
    };
    const steps: RawStep[] = [
      {
        action: 'fill',
        target: 'search box',
        value: 'laptop',
        raw: 'Enter "laptop" in the search box',
      },
    ];
    const [mapping] = mapRequirementToUI('unregistered-app-xyz', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved?.description).toBe("ui.fill('Search', 'laptop')");
  });

  test('reported defect, reproduced generically: a site-wide identically-named control across many pages, with a natural-language target for the preceding fill — the exact acceptance-test shape', () => {
    const id = `gap-test-contextapp-${Date.now()}`;
    registerApplication(id, {
      name: 'Context Test App',
      baseUrl: 'http://localhost:9999',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
      // No explicit startPath -> defaults to '/', exactly like Amazon
      // (config/applications.json has no startPath for it either).
    });
    try {
      // Every page carries the SAME identically-named "Search" input AND
      // button — a site-wide header search box repeated verbatim on every
      // page, exactly like the real reported case. By name alone this is
      // genuinely tied across all 5 pages; only the start-page bonus (Home
      // is this app's configured start page, default '/') breaks it.
      const map: ApplicationMap = {
        application: id,
        baseUrl: 'http://localhost:9999',
        generatedAt: '2026-01-01T00:00:00.000Z',
        errors: [],
        pages: [
          searchPage('Home', '/', true),
          searchPage('Category', '/category', true),
          searchPage('Results', '/results', true),
          searchPage('Cart', '/cart', true),
          searchPage('Wishlist', '/wishlist', true),
        ],
      };
      const steps: RawStep[] = [
        {
          action: 'fill',
          target: 'search box', // natural-language wording, never a literal accessible name
          value: 'laptop',
          raw: 'Enter "laptop" in the search box.',
        },
        { action: 'click', target: 'Search', raw: 'Submit the search.' },
      ];
      const mappings = mapRequirementToUI(id, map, steps);

      // Step 1: all 5 pages carry an identically-named "Search" input —
      // genuinely tied by name alone — but only Home is the start page,
      // so it alone gets the bonus and wins outright. No question.
      expect(mappings[0].confidence).toBe('HIGH');
      expect(mappings[0].ambiguous).toBeUndefined();
      expect(mappings[0].resolved?.description).toBe("ui.fill('Search', 'laptop')");
      const chosen = mappings[0].diagnostics.find((d) => d.selected);
      expect(chosen?.pageName).toBe('Home');
      expect(chosen?.reasons.some((r) => r.includes('configured starting page'))).toBe(true);

      // Step 2: with Home now the real page context, the pool narrows to
      // Home's own single "Search" button — auto-resolves too, no question.
      expect(mappings[1].confidence).toBe('HIGH');
      expect(mappings[1].ambiguous).toBeUndefined();
      expect(mappings[1].diagnostics.length).toBe(1); // never 5 identical candidates
      expect(mappings[1].diagnostics[0].pageName).toBe('Home');
      expect(mappings[1].diagnostics[0].relationship).toBe(
        "Same page as the previous step's resolved element",
      );
    } finally {
      cleanUpApp(id);
    }
  });

  test('stays genuinely ambiguous — never guesses — when the configured start page has no matching evidence at all', () => {
    const id = `gap-test-contextapp-nostart-${Date.now()}`;
    registerApplication(id, {
      name: 'No Start Evidence App',
      baseUrl: 'http://localhost:9999',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });
    try {
      const map: ApplicationMap = {
        application: id,
        baseUrl: 'http://localhost:9999',
        generatedAt: '2026-01-01T00:00:00.000Z',
        errors: [],
        pages: [
          searchPage('Home', '/', false), // start page has NO input — the real degraded-crawl case
          searchPage('Category', '/category', true),
          searchPage('Results', '/results', true),
        ],
      };
      const steps: RawStep[] = [
        {
          action: 'fill',
          target: 'search box',
          value: 'laptop',
          raw: 'Enter "laptop" in the search box.',
        },
      ];
      const [mapping] = mapRequirementToUI(id, map, steps);
      expect(mapping.confidence).toBe('MEDIUM');
      expect(mapping.resolved).toBeUndefined();
      expect(mapping.ambiguous?.candidates.length).toBe(2);
    } finally {
      cleanUpApp(id);
    }
  });

  test('ambiguity candidates carry page/url/relationship/confidence context — never bare identical labels', () => {
    const steps: RawStep[] = [{ action: 'click', target: 'Search', raw: 'Submit the search' }];
    const [mapping] = mapRequirementToUI('genericapp', MAP, steps);
    expect(mapping.ambiguous?.candidates.length).toBeGreaterThan(1);
    for (const c of mapping.ambiguous?.candidates ?? []) {
      expect(c.pageName).toBeTruthy();
      expect(c.pageUrl).toBeTruthy();
      expect(c.matchConfidence).toBeTruthy();
    }
    // No preceding step exists at all here, so there's genuinely nothing
    // to report a relationship AGAINST — must stay absent, not fabricated.
    expect(mapping.ambiguous?.candidates.every((c) => c.relationship === undefined)).toBe(true);
  });
});
