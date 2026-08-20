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
      confirmationRegions: [],
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
      confirmationRegions: [{ role: 'alert', unique: true }],
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
      confirmationRegions: [],
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

  test('a navigate step with zero static page evidence degrades to a live, role-scoped link click rather than failing outright', () => {
    // "Reports" matches no discovered page by name/nav-link evidence at
    // all — rather than block the whole workflow over a bounded-depth
    // crawl that never happened to reach a real "Reports" page, this
    // resolves live instead (see ui-mapper.ts's deferredElementResolution
    // / code-generator.ts's 'deferred-navigate' case) — auto-selected,
    // still safe (Playwright's own strict-locator mode still refuses a
    // genuinely ambiguous multi-link match at runtime).
    const steps: RawStep[] = [{ action: 'navigate', target: 'Reports', raw: 'Open Reports' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.decision).toBe('AUTO_SELECTED');
    expect(mapping.resolved).toEqual({
      kind: 'deferred-navigate',
      description: "page.getByRole('link', { name: 'Reports' }).click()",
      detail: 'Reports',
    });
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

  test('a bare verify step with no page context yet is reported unmapped rather than asserting nothing', () => {
    const steps: RawStep[] = [{ action: 'verify', raw: 'Verify something' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.unmapped?.reason).toContain('No page context');
  });

  test('MISSING VERIFICATION: a bare verify on a page with no discovered confirmation/status region is reported unmapped, not silently passed', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Leave History', raw: 'Open Leave History' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('hrms', MAP, steps);
    expect(mappings[1].resolved).toBeUndefined();
    expect(mappings[1].confidence).toBe('LOW');
    expect(mappings[1].unmapped?.reason).toContain(
      'No discovered confirmation/status element (ARIA "alert"/"status"/"log" region)',
    );
  });

  test('ACTION + VERIFICATION: "Verify confirmation is displayed" resolves to a real assertion against the discovered alert region', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
      { action: 'click', target: 'submit', raw: 'Submit the leave request' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('hrms', MAP, steps);
    expect(mappings[2].confidence).toBe('HIGH');
    expect(mappings[2].resolved).toEqual({
      kind: 'verify',
      strategy: 'role',
      confidence: 'HIGH',
      resolvedLocator: "getByRole('alert')",
      description: "expect(page.getByRole('alert')).toBeVisible()",
      detail: 'alert',
    });
  });

  test('ACTION ONLY: "Click Submit" alone generates no assertion — a click step is never treated as a verify', () => {
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
      { action: 'click', target: 'submit', raw: 'Submit the leave request' },
    ];
    const mappings = mapRequirementToUI('hrms', MAP, steps);
    expect(mappings.some((m) => m.step.action === 'verify')).toBe(false);
    expect(mappings.every((m) => m.resolved?.kind !== 'verify')).toBe(true);
  });

  test('EQUIVALENT LIVE REGIONS: two uniquely-identifiable confirmation regions (alert + status) auto-resolve, never asked about — they are the same generic announcement mechanism, not a business choice', () => {
    const ambiguousMap: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/checkout.html',
          url: 'http://localhost:9999/checkout.html',
          title: 'Checkout',
          pageName: 'Checkout',
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
          confirmationRegions: [
            { role: 'alert', unique: true },
            { role: 'status', unique: true },
          ],
          ariaSnapshot: '',
        },
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Checkout', raw: 'Open Checkout' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('hrms', ambiguousMap, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].ambiguous).toBeUndefined();
    // Ordinary (non-error) wording prefers "status" — the role ARIA
    // authoring practice itself canonically uses for advisory/result
    // announcements (its own textbook example is a search results count);
    // "alert" is reserved for error/failure wording — see the OTHER test
    // right below this one.
    expect(mappings[1].resolved).toEqual({
      kind: 'verify',
      strategy: 'role',
      confidence: 'HIGH',
      resolvedLocator: "getByRole('status')",
      description: "expect(page.getByRole('status')).toBeVisible()",
      detail: 'status',
    });
    // Both candidates still recorded (Technical Details), with the winner
    // marked and a reason explaining WHY it won over the other.
    expect(mappings[1].diagnostics.map((d) => d.value).sort()).toEqual(['alert', 'status']);
    const selected = mappings[1].diagnostics.find((d) => d.selected);
    expect(selected?.value).toBe('status');
    expect(selected?.reasons.some((r) => r.includes('preferred over'))).toBe(true);
  });

  test('ERROR WORDING PREFERS ALERT: a step whose own text names a failure/error outcome prefers the "alert" role over "status" when both are unique', () => {
    const map: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/checkout.html',
          url: 'http://localhost:9999/checkout.html',
          title: 'Checkout',
          pageName: 'Checkout',
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
          confirmationRegions: [
            { role: 'alert', unique: true },
            { role: 'status', unique: true },
          ],
          ariaSnapshot: '',
        },
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Checkout', raw: 'Open Checkout' },
      { action: 'verify', raw: 'Verify error message is displayed' },
    ];
    const mappings = mapRequirementToUI('hrms', map, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.detail).toBe('alert');
  });

  test('NO USABLE CANDIDATE: confirmation regions exist but none is uniquely identifiable — reported as unresolvable, never guessed or asked', () => {
    const map: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/checkout.html',
          url: 'http://localhost:9999/checkout.html',
          title: 'Checkout',
          pageName: 'Checkout',
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
          confirmationRegions: [
            { role: 'alert', unique: false },
            { role: 'status', unique: false },
          ],
          ariaSnapshot: '',
        },
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Checkout', raw: 'Open Checkout' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('hrms', map, steps);
    expect(mappings[1].confidence).toBe('LOW');
    expect(mappings[1].resolved).toBeUndefined();
    expect(mappings[1].ambiguous).toBeUndefined();
    expect(mappings[1].unmapped?.reason).toContain('not uniquely identifiable');
  });

  test('a human disambiguation choice for an ambiguous verify re-resolves to that exact region at HIGH confidence', () => {
    const ambiguousMap: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/checkout.html',
          url: 'http://localhost:9999/checkout.html',
          title: 'Checkout',
          pageName: 'Checkout',
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
          confirmationRegions: [
            { role: 'alert', unique: true },
            { role: 'status', unique: true },
          ],
          ariaSnapshot: '',
        },
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Checkout', raw: 'Open Checkout' },
      { action: 'verify', target: 'status', raw: 'Verify confirmation is displayed' },
    ];
    const mappings = mapRequirementToUI('hrms', ambiguousMap, steps);
    expect(mappings[1].confidence).toBe('HIGH');
    expect(mappings[1].resolved?.detail).toBe('status');
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

  test('a bare "Open Leave" alone (no corroborating steps) is genuinely ambiguous between two same-named pages — fails safely, never guessed', () => {
    // "Leave" matches both "Apply Leave" and "Leave History" by name alone,
    // tied — with nothing else to go on, normal automation must fail
    // safely, never guess and never stop to ask (see the auto-locator-
    // selection product requirement).
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.confidence).toBe('LOW');
    expect(mapping.decision).toBe('SAFE_FAILURE');
    expect(mapping.resolved).toBeUndefined();
    expect(mapping.diagnostics.map((c) => c.label).sort()).toEqual([
      'Apply Leave',
      'Leave History',
    ]);
  });

  test('a later fill/submit step never corroborates "Open Leave" — upcoming-step evidence must not score the current navigate step', () => {
    // Same ambiguous pair as the bare case above, now followed by fill/submit
    // steps that (before this fix) used to "corroborate" Apply Leave into a
    // false HIGH match. Confidence must be identical to the bare case —
    // proving upcoming steps contribute nothing to navigate scoring.
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

    expect(mappings[0].confidence).toBe('LOW');
    expect(mappings[0].decision).toBe('SAFE_FAILURE');
    expect(mappings[0].resolved).toBeUndefined();
    expect(mappings[0].diagnostics.map((c) => c.label).sort()).toEqual([
      'Apply Leave',
      'Leave History',
    ]);
  });

  test('a heading that merely mentions the target word is NOT navigation evidence (the reported false positive)', () => {
    // Mirrors the real bug exactly: a Login page's <h1> tagline ("Employee
    // Leave Management") contains the word "Leave", but Login has no
    // navigational relationship to a Leave page at all — it must not be
    // surfaced as a candidate just because of that.
    const loginOnlyMap: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/login.html',
          url: 'http://localhost:9999/login.html',
          title: 'HRMS Login',
          pageName: 'HRMS Login',
          headings: ['Employee Leave Management'],
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
          confirmationRegions: [],
          ariaSnapshot: '',
        },
      ],
    };
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('hrms', loginOnlyMap, steps);
    // Zero PAGE-level evidence for "Leave" (never "best-guess" Login) — the
    // core assertion this test exists for. With no static page to land on
    // at all, this now degrades to a live, role-scoped link click (see
    // "reports an unmapped navigate step..." above) instead of failing
    // outright — but it must never resolve to Login itself: the diagnostic
    // and target are both about the step's own "Leave" wording, never
    // Login-page-specific evidence (its heading/submit button).
    expect(mapping.diagnostics).toHaveLength(1);
    expect(mapping.diagnostics[0].reasons.join(' ')).not.toContain('Login');
    expect(mapping.resolved).toEqual({
      kind: 'deferred-navigate',
      description: "page.getByRole('link', { name: 'Leave' }).click()",
      detail: 'Leave',
    });
  });

  test('FAIL CASE: a login page with a heading containing the target AND a verified submit button is NOT selected for "Open Leave"', () => {
    // Exact shape of the reported regression: "Open Leave" followed by
    // "Submit the leave request" used to let Login's own Login button
    // (a verified native submit control) "corroborate" a false match —
    // upcoming-step evidence must not reach navigate scoring at all now.
    const loginOnlyMap: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/login.html',
          url: 'http://localhost:9999/login.html',
          title: 'HRMS Login',
          pageName: 'HRMS Login',
          headings: ['Employee Leave Management'],
          buttons: [{ role: 'button', name: 'Login', isSubmit: true, verified: VERIFIED }],
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
          confirmationRegions: [],
          ariaSnapshot: '',
        },
      ],
    };
    const steps: RawStep[] = [
      { action: 'navigate', target: 'Leave', raw: 'Open Leave' },
      { action: 'click', target: 'submit', raw: 'Submit the leave request' },
    ];
    const [mapping] = mapRequirementToUI('hrms', loginOnlyMap, steps);
    // Zero PAGE-level evidence, and never Login's own submit button
    // "corroborating" a false match (the exact reported regression) — the
    // core assertion this test exists for. Degrades to a live link click
    // on the step's own "Leave" wording, same as the sibling test above.
    expect(mapping.diagnostics).toHaveLength(1);
    expect(mapping.diagnostics[0].reasons.join(' ')).not.toContain('Login');
    expect(mapping.resolved).toEqual({
      kind: 'deferred-navigate',
      description: "page.getByRole('link', { name: 'Leave' }).click()",
      detail: 'Leave',
    });
  });

  test('PASS CASE: a navigation link named "Leave" with href "/leave.html" resolves "Open Leave" at HIGH confidence', () => {
    const navMap: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/dashboard.html',
          url: 'http://localhost:9999/dashboard.html',
          title: 'Dashboard',
          pageName: 'Dashboard',
          headings: [],
          buttons: [],
          links: [{ role: 'link', name: 'Leave', href: '/leave.html', verified: VERIFIED }],
          inputs: [],
          selects: [],
          checkboxes: [],
          tables: 0,
          forms: 0,
          navigation: 0,
          testIds: [],
          confirmationRegions: [],
          ariaSnapshot: '',
        },
        {
          path: '/leave.html',
          url: 'http://localhost:9999/leave.html',
          title: 'Leave',
          pageName: 'Leave',
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
        },
      ],
    };
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('hrms', navMap, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved).toEqual({
      kind: 'navigate',
      description: "page.goto('/leave.html')",
      detail: '/leave.html',
    });
  });

  test('a verified link whose href actually points to the target page is real navigation evidence, unlike a heading match', () => {
    const navMap: ApplicationMap = {
      application: 'fixture-app',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [
        {
          path: '/dashboard.html',
          url: 'http://localhost:9999/dashboard.html',
          title: 'Dashboard',
          pageName: 'Dashboard',
          headings: [],
          buttons: [],
          links: [
            { role: 'link', name: 'Apply Leave', href: '/apply-leave.html', verified: VERIFIED },
          ],
          inputs: [],
          selects: [],
          checkboxes: [],
          tables: 0,
          forms: 0,
          navigation: 0,
          testIds: [],
          confirmationRegions: [],
          ariaSnapshot: '',
        },
        {
          // Deliberately NOT named "Leave" anywhere — the only evidence this
          // is the right page is the Dashboard's link actually pointing here.
          path: '/apply-leave.html',
          url: 'http://localhost:9999/apply-leave.html',
          title: 'Untitled Form Page',
          pageName: 'Untitled Form Page',
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
        },
      ],
    };
    const steps: RawStep[] = [{ action: 'navigate', target: 'Leave', raw: 'Open Leave' }];
    const [mapping] = mapRequirementToUI('hrms', navMap, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved?.detail).toBe('/apply-leave.html');
  });

  test('"Verify text containing Leave" is unaffected by page-navigation matching entirely', () => {
    // Structural guarantee, not just a heuristic: verify steps never
    // consult ApplicationMap.pages at all, so this false-positive class
    // cannot apply to them regardless of wording overlap with "Open <page>".
    const steps: RawStep[] = [
      {
        action: 'verify',
        value: 'Leave application submitted',
        raw: 'Verify "Leave application submitted" is shown',
      },
    ];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.resolved).toEqual({
      kind: 'verify',
      description: 'expect(page.getByText("Leave application submitted")).toBeVisible()',
      detail: 'Leave application submitted',
    });
  });

  test('an EXPLICIT "{{api:201}}" marker resolves to a distinct verify-api kind, at HIGH confidence, with no ApplicationMap lookup needed', () => {
    const steps: RawStep[] = [
      { action: 'verify', value: '{{api:201}}', raw: 'Verify API returns 201' },
    ];
    const [mapping] = mapRequirementToUI('hrms', MAP, steps);
    expect(mapping.confidence).toBe('HIGH');
    expect(mapping.resolved).toEqual({
      kind: 'verify-api',
      description: 'expect(submitResponse.status()).toBe(201)',
      detail: '201',
    });
  });
});
