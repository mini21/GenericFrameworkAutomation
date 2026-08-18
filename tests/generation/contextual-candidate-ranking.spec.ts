import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { ApplicationMap, PageMap } from '../../src/core/discovery/discovery-types';
import { RawStep } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

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
