import { test, expect } from '../../src/core/fixtures/base.fixture';
import { parseRequirement } from '../../src/core/generation/requirement-parser';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { generateSpecFile } from '../../src/core/generation/code-generator';
import { ApplicationMap, PageMap } from '../../src/core/discovery/discovery-types';
import { RawStep, TestSpecification } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

// Generic proof that SELECT (a native <select>/combobox) and CHECK (a
// checkbox) are first-class, resolvable actions — not folded into fill or
// click. Before this, page-crawler.ts already DISCOVERED selects/
// checkboxes, but no RawStep action could ever reach them: `elementPool`
// only ever built a fill (inputs) or click (buttons+links) pool, so a
// "Select ... for Role"/"Check the ... checkbox" step was either silently
// mis-mapped as a fill (a <select> is not fillable — Playwright's
// `.fill()` throws on one) or fell through to a click pool with nothing to
// match. Nothing here is app-specific: "Role"/"Terms" are generic example
// field names, exercised only through the real parser/mapper/generator.

const VERIFIED = {
  strategy: 'role' as const,
  confidence: 'HIGH' as const,
  resolvedLocator: 'getByRole(...)',
};

function page(overrides: Partial<PageMap>): PageMap {
  return {
    path: '/',
    url: 'http://localhost:9999/',
    title: 'Form',
    pageName: 'Form',
    headings: [],
    buttons: [],
    links: [],
    inputs: [],
    selects: [],
    checkboxes: [],
    tables: 0,
    forms: 1,
    navigation: 0,
    testIds: [],
    confirmationRegions: [],
    ariaSnapshot: '',
    ...overrides,
  };
}

function mapOf(...pages: PageMap[]): ApplicationMap {
  return {
    application: 'genericapp',
    baseUrl: 'http://localhost:9999',
    generatedAt: '2026-01-01T00:00:00.000Z',
    errors: [],
    pages,
  };
}

test.describe(`Generation — SELECT action ${TAGS.SMOKE}`, () => {
  test('requirement-parser recognizes "Select "X" for Y" as a SELECT action, not fill', () => {
    const { steps } = parseRequirement('Select "Manager" for Role.');
    expect(steps).toEqual([
      { action: 'select', target: 'Role', value: 'Manager', raw: 'Select "Manager" for Role' },
    ]);
  });

  test('ui-mapper resolves a select step against a discovered <select>, never against a same-named button or input', () => {
    const map = mapOf(
      page({
        buttons: [{ role: 'button', name: 'Role', verified: VERIFIED }],
        inputs: [{ role: 'textbox', name: 'Role', verified: VERIFIED }],
        selects: [{ role: 'combobox', name: 'Role', inputType: 'select', verified: VERIFIED }],
      }),
    );
    const steps: RawStep[] = [{ action: 'select', target: 'Role', value: 'Manager', raw: 'x' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved?.kind).toBe('select');
    expect(mapping.resolved?.description).toBe("ui.selectOption('Role', 'Manager')");
  });

  test('an unverified/absent <select> is reported unmapped, never guessed against a same-named button', () => {
    const map = mapOf(page({ buttons: [{ role: 'button', name: 'Role', verified: VERIFIED }] }));
    const steps: RawStep[] = [{ action: 'select', target: 'Role', value: 'Manager', raw: 'x' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.unmapped).toBeDefined();
  });

  test('code-generator emits ui.selectOption(...) for a resolved select step', () => {
    const spec: TestSpecification = {
      requirementId: 'GEN-001',
      requirementText: 'Admin should be able to set a role.',
      testName: 'admin can set a role',
      application: 'hrms',
      module: 'users',
      type: 'functional',
      preconditions: [],
      expectedResults: [],
      steps: [
        {
          step: {
            action: 'select',
            target: 'Role',
            value: 'Manager',
            raw: 'Select "Manager" for Role',
          },
          confidence: 'HIGH',
          diagnostics: [],
          resolved: {
            kind: 'select',
            description: "ui.selectOption('Role', 'Manager')",
            strategy: 'role',
            confidence: 'HIGH',
            resolvedLocator: "getByRole('combobox')",
            detail: 'Role',
          },
        },
      ],
    };
    const { code } = generateSpecFile(spec);
    expect(code).toContain('await ui.selectOption("Role", "Manager");');
  });
});

test.describe(`Generation — CHECK action ${TAGS.SMOKE}`, () => {
  test('requirement-parser recognizes "Check the X checkbox" as a CHECK action', () => {
    const { steps } = parseRequirement('Check the Terms and Conditions checkbox.');
    expect(steps).toEqual([
      {
        action: 'check',
        target: 'Terms and Conditions',
        raw: 'Check the Terms and Conditions checkbox',
      },
    ]);
  });

  test('requirement-parser recognizes "Check the checkbox for X" (box-word first) too', () => {
    const { steps } = parseRequirement('Check the checkbox for I agree to the terms.');
    expect(steps).toEqual([
      {
        action: 'check',
        target: 'I agree to the terms',
        raw: 'Check the checkbox for I agree to the terms',
      },
    ]);
  });

  test('a plain "Check that X is displayed"/"Check X is displayed" is still a VERIFY, never mistaken for a checkbox action', () => {
    expect(parseRequirement('Check that results are displayed.').steps).toEqual([
      { action: 'verify', raw: 'Check that results are displayed' },
    ]);
    expect(parseRequirement('Check order is created.').steps).toEqual([
      { action: 'verify', raw: 'Check order is created' },
    ]);
  });

  test('ui-mapper resolves a check step against a discovered checkbox, never against a same-named button', () => {
    const map = mapOf(
      page({
        buttons: [{ role: 'button', name: 'Terms', verified: VERIFIED }],
        checkboxes: [{ role: 'checkbox', name: 'Terms', verified: VERIFIED }],
      }),
    );
    const steps: RawStep[] = [
      { action: 'check', target: 'Terms', raw: 'Check the Terms checkbox' },
    ];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved?.kind).toBe('check');
    expect(mapping.resolved?.description).toBe("ui.check('Terms')");
  });

  test('code-generator emits ui.check(...) for a resolved check step', () => {
    const spec: TestSpecification = {
      requirementId: 'GEN-002',
      requirementText: 'User should be able to accept terms.',
      testName: 'user can accept terms',
      application: 'hrms',
      module: 'signup',
      type: 'functional',
      preconditions: [],
      expectedResults: [],
      steps: [
        {
          step: { action: 'check', target: 'Terms', raw: 'Check the Terms checkbox' },
          confidence: 'HIGH',
          diagnostics: [],
          resolved: {
            kind: 'check',
            description: "ui.check('Terms')",
            strategy: 'role',
            confidence: 'HIGH',
            resolvedLocator: "getByRole('checkbox')",
            detail: 'Terms',
          },
        },
      ],
    };
    const { code } = generateSpecFile(spec);
    expect(code).toContain('await ui.check("Terms");');
  });
});
