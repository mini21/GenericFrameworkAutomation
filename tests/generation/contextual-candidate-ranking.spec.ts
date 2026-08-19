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

// ---------------------------------------------------------------------------
// Confidence-driven, self-resolving candidate policy — a Manual QA must
// never be shown a technical locator choice (getByRole('alert') vs
// getByRole('status')) when the candidates are equally-valid generic
// mechanisms for the same business outcome. Labeled A-F to match the
// exact regression matrix requested; several reuse fixtures/mechanisms
// already exercised above under their own names — kept here too as a
// single, explicit, directly-traceable checklist.
// ---------------------------------------------------------------------------
function confirmationPage(
  regions: { role: 'alert' | 'status' | 'log'; unique: boolean }[],
): PageMap {
  return {
    path: '/result',
    url: 'http://localhost:9999/result',
    title: 'Result',
    pageName: 'Result',
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
    confirmationRegions: regions,
    ariaSnapshot: '',
  };
}

test.describe(`Generation — confidence-driven candidate resolution ${TAGS.SMOKE}`, () => {
  test('A. two equivalent ARIA live regions (alert + status) auto-resolve — never a technical locator question', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        confirmationPage([
          { role: 'alert', unique: true },
          { role: 'status', unique: true },
        ]),
      ],
    };
    // Deliberately notification-flavored wording (not "results"/"items"/
    // "list") — this test is specifically about alert/status equivalence;
    // a CONTENT-flavored assertion now resolves via a different, more
    // appropriate mechanism entirely (see the dedicated content-assertion
    // tests below), so it must not accidentally exercise that path here.
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify confirmation message is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
    expect(mappings[1].resolved).toBeDefined();
  });

  test('B. multiple genuinely different, identically-named controls with no distinguishing context — a real business choice — still asks', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        searchPage('Employee Form', '/employee-form', false),
        searchPage('Manager Form', '/manager-form', false),
      ],
    };
    // No preceding step establishes which of the two forms is in play —
    // "Search" here stands in for a same-named control on two genuinely
    // unrelated pages, exactly like an "Employee form"/"Manager form"
    // pair each with their own identically-labeled Submit control.
    const steps: RawStep[] = [{ action: 'click', target: 'Search', raw: 'Submit the form' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('MEDIUM');
    expect(mapping.ambiguous?.candidates.length).toBe(2);
  });

  test('C. the same control text on different pages resolves via the page a preceding step already established', () => {
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
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
  });

  test("D. an input followed by submit uses the input's own page/form context, not a copy on another page", () => {
    const steps: RawStep[] = [
      {
        action: 'fill',
        target: 'search box',
        value: 'laptop',
        raw: 'Enter "laptop" in the search box.',
      },
      { action: 'click', target: 'Search', raw: 'Submit the search.' },
    ];
    const mappings = mapRequirementToUI('genericapp', MAP, steps);
    expect(mappings[0].confidence).toBe('HIGH');
    expect(mappings[1].confidence).toBe('HIGH');
    expect(
      mappings[1].diagnostics.some(
        (d) => d.relationship === "Same page as the previous step's resolved element",
      ),
    ).toBe(true);
  });

  test('E. a success message with alert/status alternatives auto-resolves — the exact acceptance-test shape', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        confirmationPage([
          { role: 'status', unique: true },
          { role: 'alert', unique: true },
        ]),
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify success message is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
    expect(mappings[1].resolved?.kind).toBe('verify');
  });

  test('F. no usable candidate at all — clearly reported as unresolvable, never guessed and never asked', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [confirmationPage([])],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('LOW');
    expect(mappings[1].resolved).toBeUndefined();
    expect(mappings[1].ambiguous).toBeUndefined();
    expect(mappings[1].unmapped?.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reproduces the FOLLOW-UP reported defect: even after the start-page bonus
// (above), a step 1 fill target could still surface 5 candidates from
// mostly-irrelevant pages (a 404 error page, an "about" page, a privacy
// page, ...) because a page-irrelevant EXACT string match ("Search") could
// outscore the actually-relevant input ("Search Amazon") on the real start
// page even WITH the bonus — an additive score can never fully overcome a
// big enough raw name-match gap. Fixed architecturally (see
// mapRequirementToUI's `elementPool`/primaryPage logic): page/context
// filtering is now a PRE-FILTER stage, before semantic name scoring ever
// runs — the start/current page's own candidates are tried FIRST and, as
// long as ANY exist, win outright, with cross-page search only as a
// fallback when that page has nothing at all. Nothing here is
// Amazon-specific — a registered "gap-test-*" fixture app stands in, and
// the "irrelevant" pages are named generically (Help/About/Settings).
// ---------------------------------------------------------------------------

test.describe(`Generation — page-context pre-filtering (action-aware resolution) ${TAGS.SMOKE}`, () => {
  test('1. a fill target never considers a button/link candidate at all, even one that exact-matches by name', () => {
    const map: ApplicationMap = {
      application: 'x',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          ...searchPage('Home', '/', false),
          // The ONLY "Search"-named thing on this page is a button/link —
          // never a candidate for a fill action, no matter how well its
          // name matches.
          buttons: [{ role: 'button', name: 'Search', verified: VERIFIED }],
          links: [{ role: 'link', name: 'Search', verified: VERIFIED }],
        },
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
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.confidence).toBe('LOW');
    expect(mapping.diagnostics.length).toBe(0); // no button/link ever entered scoring
  });

  test('2. an exact-name match on an irrelevant page never outscores the real search input on the application start page', () => {
    const id = `gap-test-pagefilter-${Date.now()}`;
    registerApplication(id, {
      name: 'Page Filter Test App',
      baseUrl: 'http://localhost:9999',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
      // No startPath -> defaults to '/', exactly like Amazon.
    });
    try {
      const homeInput: PageMap = {
        ...searchPage('Home', '/', true),
        inputs: [{ role: 'textbox', name: 'Search Amazon', verified: VERIFIED }],
      };
      const helpPage: PageMap = {
        ...searchPage('Help', '/help', false),
        buttons: [],
        links: [],
        // An EXACT string match ("search" === "search") — deliberately
        // the strongest possible raw name score, on a page that has
        // nothing to do with the actual product-search workflow.
        inputs: [{ role: 'textbox', name: 'Search', verified: VERIFIED }],
      };
      const aboutPage: PageMap = {
        ...searchPage('About', '/about', false),
        buttons: [],
        links: [],
        inputs: [{ role: 'textbox', name: 'Search', verified: VERIFIED }],
      };
      const map: ApplicationMap = {
        application: id,
        baseUrl: 'http://localhost:9999',
        generatedAt: '2026-01-01T00:00:00.000Z',
        errors: [],
        pages: [homeInput, helpPage, aboutPage],
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
      expect(mapping.confidence).toBe('HIGH');
      expect(mapping.ambiguous).toBeUndefined();
      expect(mapping.resolved?.description).toBe("ui.fill('Search Amazon', 'laptop')");
      expect(mapping.diagnostics.length).toBe(1); // Help/About were never even in the pool
    } finally {
      cleanUpApp(id);
    }
  });

  test('3. a search input followed by submit resolves the submit control using that same page/form context', () => {
    const id = `gap-test-pagefilter-submit-${Date.now()}`;
    registerApplication(id, {
      name: 'Page Filter Submit App',
      baseUrl: 'http://localhost:9999',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });
    try {
      const home: PageMap = {
        ...searchPage('Home', '/', true),
        inputs: [{ role: 'textbox', name: 'Search Amazon', verified: VERIFIED }],
        buttons: [{ role: 'button', name: 'Go', isSubmit: true, verified: VERIFIED }],
      };
      const settingsPage: PageMap = {
        ...searchPage('Settings', '/settings', false),
        inputs: [],
        buttons: [{ role: 'button', name: 'Go', isSubmit: true, verified: VERIFIED }],
      };
      const map: ApplicationMap = {
        application: id,
        baseUrl: 'http://localhost:9999',
        generatedAt: '2026-01-01T00:00:00.000Z',
        errors: [],
        pages: [home, settingsPage],
      };
      const steps: RawStep[] = [
        {
          action: 'fill',
          target: 'search box',
          value: 'laptop',
          raw: 'Enter "laptop" in the search box.',
        },
        { action: 'click', target: 'submit', raw: 'Submit the search.' },
      ];
      const mappings = mapRequirementToUI(id, map, steps);
      expect(mappings[0].confidence).toBe('HIGH');
      expect(mappings[1].confidence).toBe('HIGH');
      expect(mappings[1].diagnostics.length).toBe(1); // Settings' own "Go" was never a candidate
      expect(mappings[1].diagnostics[0].pageName).toBe('Home');
    } finally {
      cleanUpApp(id);
    }
  });

  test('4. multiple alert/status live regions auto-resolve a NOTIFICATION assertion, never a technical role question', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        confirmationPage([
          { role: 'alert', unique: true },
          { role: 'status', unique: true },
        ]),
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify confirmation message is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
  });

  test('5. two genuinely different forms with no distinguishing context still ask the Manual QA', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        searchPage('Employee Form', '/employee', false),
        searchPage('Manager Form', '/manager', false),
      ],
    };
    const steps: RawStep[] = [{ action: 'click', target: 'Search', raw: 'Submit the form' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('MEDIUM');
    expect(mapping.ambiguous?.candidates.length).toBe(2);
  });

  test('6. the same text on unrelated pages resolves via page/context once a preceding step establishes it', () => {
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
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Assertion-INTENT classification — a bare verify is not one undifferentiated
// "something was announced" check. A CONTENT assertion ("search results"/
// "product list"/"matching items" are displayed) asks whether actual result
// content rendered — an ARIA live region does not reliably answer that (it
// can exist and stay empty while results render via an ordinary page
// navigation, no live-region update involved at all — a very common real
// pattern, and exactly what broke the Amazon acceptance test: a discovered
// "status" region resolved and passed generation, but nothing ever made it
// visible on the real results page). A NOTIFICATION assertion ("success
// message"/"error"/"confirmation") is exactly what a live region DOES
// represent, and keeps using it. Classification is by the step's OWN
// generic English wording only — no per-application vocabulary.
// ---------------------------------------------------------------------------
test.describe(`Generation — assertion-intent classification (content vs notification) ${TAGS.SMOKE}`, () => {
  test('1. "Verify search results are displayed" prefers result content over a status/alert region', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [confirmationPage([{ role: 'status', unique: true }])],
    };
    const steps: RawStep[] = [
      {
        action: 'fill',
        target: 'search box',
        value: 'laptop',
        raw: 'Enter "laptop" in the search box.',
      },
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify that search results are displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[2].confidence).toBe('HIGH');
    expect(mappings[2].resolved?.strategy).toBe('text');
    expect(mappings[2].resolved?.detail).toBe('laptop');
    expect(mappings[2].resolved?.resolvedLocator).not.toContain('status');
    expect(mappings[2].resolved?.description).toBe(
      'expect(page.getByText("laptop").first()).toBeVisible()',
    );
  });

  test('2. "Verify success message is displayed" — a notification assertion — still resolves via alert/status', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [confirmationPage([{ role: 'status', unique: true }])],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify success message is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.strategy).toBe('role');
    expect(mappings[1].resolved?.detail).toBe('status');
  });

  test('3. "Verify error message is displayed" — a notification assertion — resolves via alert/status, preferring alert', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        confirmationPage([
          { role: 'alert', unique: true },
          { role: 'status', unique: true },
        ]),
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify error message is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.strategy).toBe('role');
    expect(mappings[1].resolved?.detail).toBe('alert');
  });

  test('4. "Verify product list is displayed" prefers content (the searched term) over a status region', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [confirmationPage([{ role: 'status', unique: true }])],
    };
    const steps: RawStep[] = [
      {
        action: 'fill',
        target: 'search box',
        value: 'phone',
        raw: 'Enter "phone" in the search box.',
      },
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify product list is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[2].confidence).toBe('HIGH');
    expect(mappings[2].resolved?.strategy).toBe('text');
    expect(mappings[2].resolved?.detail).toBe('phone');
  });

  test('5. "Verify confirmation is displayed" — notification wording — resolves via alert/status as before', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [confirmationPage([{ role: 'alert', unique: true }])],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.strategy).toBe('role');
    expect(mappings[1].resolved?.detail).toBe('alert');
  });

  test("6. the complete search -> submit -> results sequence uses the fill step's own value as the results-page evidence — the exact Amazon acceptance shape", () => {
    const id = `gap-test-contentassert-${Date.now()}`;
    registerApplication(id, {
      name: 'Content Assertion App',
      baseUrl: 'http://localhost:9999',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });
    try {
      const home: PageMap = {
        ...searchPage('Home', '/', true),
        inputs: [{ role: 'textbox', name: 'Search Amazon', verified: VERIFIED }],
        buttons: [{ role: 'button', name: 'Go', isSubmit: true, verified: VERIFIED }],
        confirmationRegions: [{ role: 'status', unique: true }],
      };
      const map: ApplicationMap = {
        application: id,
        baseUrl: 'http://localhost:9999',
        generatedAt: '2026-01-01T00:00:00.000Z',
        errors: [],
        pages: [home],
      };
      const steps: RawStep[] = [
        {
          action: 'fill',
          target: 'search box',
          value: 'laptop',
          raw: 'Enter "laptop" in the search box.',
        },
        { action: 'click', target: 'submit', raw: 'Submit the search.' },
        { action: 'verify', raw: 'Verify that search results are displayed.' },
      ];
      const mappings = mapRequirementToUI(id, map, steps);
      expect(mappings[0].confidence).toBe('HIGH'); // search input
      expect(mappings[1].confidence).toBe('HIGH'); // submit control
      expect(mappings[2].confidence).toBe('HIGH'); // results assertion
      expect(mappings[2].resolved?.strategy).toBe('text');
      expect(mappings[2].resolved?.detail).toBe('laptop');
      expect(mappings[2].resolved?.resolvedLocator).not.toContain('status');
      // Never asked a technical locator question at any point in the sequence.
      expect(mappings.every((m) => m.ambiguous === undefined)).toBe(true);
    } finally {
      cleanUpApp(id);
    }
  });

  test('content assertion with no preceding fill value and nothing else to go on is honestly reported unmapped, never guessed as a status/alert region', () => {
    const map: ApplicationMap = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [confirmationPage([{ role: 'status', unique: true }])],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Result', raw: 'Open Result' },
      { action: 'verify', raw: 'Verify that search results are displayed' },
    ];
    const mappings = mapRequirementToUI('genericapp', map, steps);
    expect(mappings[1].confidence).toBe('LOW');
    expect(mappings[1].resolved).toBeUndefined();
    expect(mappings[1].unmapped?.reason).toContain('result/content');
  });
});
