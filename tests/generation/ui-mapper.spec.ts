import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { ApplicationMap } from '../../src/core/discovery/discovery-types';
import { RawStep } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

const VERIFIED = {
  strategy: 'role' as const,
  confidence: 'HIGH' as const,
  resolvedLocator: 'getByRole(...)',
};

const MAP: ApplicationMap = {
  application: 'fixture-app',
  baseUrl: 'http://localhost:9999',
  generatedAt: '2026-01-01T00:00:00.000Z',
  errors: [],
  pages: [
    {
      path: '/login.html',
      url: 'http://localhost:9999/login.html',
      title: 'Login',
      pageName: 'Login',
      headings: [],
      buttons: [{ role: 'button', name: 'Login', verified: VERIFIED }],
      links: [],
      inputs: [
        { role: 'textbox', name: 'Username', verified: VERIFIED },
        { role: 'textbox', name: 'Password', verified: VERIFIED },
      ],
      selects: [],
      checkboxes: [],
      tables: 0,
      forms: 0,
      navigation: 0,
      testIds: [],
      ariaSnapshot: '',
    },
    {
      path: '/apply-leave.html',
      url: 'http://localhost:9999/apply-leave.html',
      title: 'Apply Leave',
      pageName: 'Apply Leave',
      headings: [],
      buttons: [
        { role: 'button', name: 'Submit Application', isSubmit: true, verified: VERIFIED },
        { role: 'button', name: 'Cancel', verified: undefined },
      ],
      links: [],
      inputs: [
        { role: 'textbox', name: 'Reason', verified: VERIFIED },
        { role: 'textbox', name: 'Comment', verified: undefined },
      ],
      selects: [],
      checkboxes: [],
      tables: 0,
      forms: 0,
      navigation: 0,
      testIds: [],
      ariaSnapshot: '',
    },
    {
      path: '/leave-history.html',
      url: 'http://localhost:9999/leave-history.html',
      title: 'Leave History',
      pageName: 'Leave History',
      headings: [],
      buttons: [],
      links: [],
      inputs: [],
      selects: [],
      checkboxes: [],
      tables: 1,
      forms: 0,
      navigation: 0,
      testIds: [],
      ariaSnapshot: '',
    },
  ],
};

test.describe(`Generation — UI mapper ${TAGS.SMOKE}`, () => {
  test('reuses the real hrms login helper when generating for application "hrms"', () => {
    const steps: RawStep[] = [{ action: 'login', target: 'employee', raw: 'Login as employee' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.resolved?.kind).toBe('login-helper');
    expect(mapping.resolved?.description).toContain('loginAsHrmsUser');
    expect(mapping.unmapped).toBeUndefined();
  });

  test('falls back to inline login (from a discovered login page) for an application with no reusable helper', () => {
    const steps: RawStep[] = [{ action: 'login', target: 'employee', raw: 'Login as employee' }];
    const [mapping] = mapRequirementToUI('no-such-application-xyz', MAP, steps);
    expect(mapping.resolved?.kind).toBe('login-inline');
    expect(mapping.resolved?.description).toContain('/login.html');
    expect(mapping.resolved?.description).toContain('Username');
  });

  test('maps a navigate step to the uniquely-named discovered page', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
    ];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.resolved).toEqual({
      kind: 'navigate',
      description: "page.goto('/apply-leave.html')",
      detail: '/apply-leave.html',
    });
  });

  test('reports an unmapped navigate step with a clear reason when no page matches', () => {
    const steps: RawStep[] = [{ action: 'navigate', target: 'Reports', raw: 'Open Reports' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.unmapped?.reason).toContain(
      'No discovered page provides any evidence for "Reports"',
    );
  });

  test('scopes fill/click lookups to the most recently navigated page', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
      { action: 'fill', target: 'Reason', value: 'Trip', raw: 'Fill Reason as "Trip"' },
      { action: 'click', target: 'submit', raw: 'Submit the request' },
    ];
    const mappings = mapRequirementToUI('hrms', MAP, steps);
    expect(mappings[1].resolved?.description).toBe("ui.fill('Reason', 'Trip')");
    expect(mappings[2].resolved?.description).toBe("ui.click('Submit Application')");
  });

  test('a discovered but unverified (ambiguous/hidden) field is reported unmapped, not guessed', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
      { action: 'fill', target: 'Comment', value: 'x', raw: 'Fill Comment as "x"' },
    ];
    const mappings = mapRequirementToUI('hrms', MAP, steps);
    expect(mappings[1].unmapped?.reason).toContain('not currently verified as uniquely fillable');
  });

  test('a verify step with no expected text is reported unmapped rather than asserting nothing', () => {
    const steps: RawStep[] = [{ action: 'verify', raw: 'Verify something' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.unmapped?.reason).toContain('no expected text');
  });

  test('a verify step with quoted text maps to a getByText assertion, not LocatorResolver', () => {
    const steps: RawStep[] = [{ action: 'verify', value: 'Done', raw: 'Verify "Done" is shown' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.resolved).toEqual({
      kind: 'verify',
      description: 'expect(page.getByText("Done")).toBeVisible()',
      detail: 'Done',
    });
  });

  test('a bare "Open Leave" alone (no corroborating steps) is genuinely ambiguous between two same-named pages', () => {
    // "Leave" matches both "Apply Leave" and "Leave History" by name alone
    // — with nothing else to go on, this must ask, never guess.
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.confidence).toBe('MEDIUM');
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.ambiguous?.candidates.map((c) => c.label).sort()).toEqual([
      'Apply Leave',
      'Leave History',
    ]);
  });

  test('"Open Leave" resolves to "Apply Leave" (not "Leave History") once upcoming steps corroborate it — this is the reported bug', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Leave', raw: 'Open Leave' },
      {
        action: 'fill',
        target: 'Reason',
        value: '{{date:start}}',
        raw: 'Select start and end dates',
      },
      { action: 'click', target: 'submit', raw: 'Submit the leave request' },
    ];
    const mappings = mapRequirementToUI('hrms', MAP, steps);

    expect(mappings[0].confidence).toBe('HIGH');
    expect(mappings[0].resolved?.detail).toBe('/apply-leave.html');
    // currentPage was correctly updated to Apply Leave, so the next steps resolve too:
    expect(mappings[1].resolved?.description).toBe("ui.fill('Reason', startDate)");
    expect(mappings[2].resolved?.description).toBe("ui.click('Submit Application')");
  });
});
