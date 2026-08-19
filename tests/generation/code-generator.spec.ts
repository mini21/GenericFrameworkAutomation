import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { generateSpecFile } from '../../src/core/generation/code-generator';
import { TestSpecification } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

const SPEC: TestSpecification = {
  requirementId: 'LEAVE-999',
  requirementText: 'Employee should be able to apply leave.',
  testName: 'employee can apply leave via code-generator test',
  application: 'hrms',
  module: 'leave',
  type: 'functional',
  preconditions: ['User is authenticated'],
  expectedResults: ['Leave application submitted successfully'],
  steps: [
    {
      step: { action: 'login', target: 'employee', raw: 'Login as employee' },
      confidence: 'HIGH',
      diagnostics: [],
      resolved: {
        kind: 'login-helper',
        description: 'loginAsHrmsUser(page, ui, profile.employee)',
        detail: JSON.stringify({
          moduleName: 'hrms-auth',
          functionName: 'loginAsHrmsUser',
          profileKey: 'employee',
        }),
      },
    },
    {
      step: { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
      confidence: 'HIGH',
      diagnostics: [],
      resolved: {
        kind: 'navigate',
        description: "page.goto('/apply-leave.html')",
        detail: '/apply-leave.html',
      },
    },
    {
      step: {
        action: 'fill',
        target: 'Start Date',
        value: '{{date:start}}',
        raw: 'Select start and end dates',
      },
      confidence: 'HIGH',
      diagnostics: [],
      resolved: {
        kind: 'fill',
        description: "ui.fill('Start Date', startDate)",
        strategy: 'role',
        confidence: 'HIGH',
        resolvedLocator: 'getByRole(...)',
        detail: 'Start Date',
      },
    },
    {
      step: {
        action: 'fill',
        target: 'Reason',
        value: 'Family trip',
        raw: 'Fill Reason as "Family trip"',
      },
      confidence: 'HIGH',
      diagnostics: [],
      resolved: {
        kind: 'fill',
        description: "ui.fill('Reason', 'Family trip')",
        strategy: 'role',
        confidence: 'HIGH',
        resolvedLocator: 'getByRole(...)',
        detail: 'Reason',
      },
    },
    {
      step: { action: 'click', target: 'submit', raw: 'Submit the request' },
      confidence: 'HIGH',
      diagnostics: [],
      resolved: {
        kind: 'click',
        description: "ui.click('Submit Application')",
        strategy: 'role',
        confidence: 'HIGH',
        resolvedLocator: 'getByRole(...)',
        detail: 'Submit Application',
      },
    },
    {
      step: {
        action: 'verify',
        value: 'Leave application submitted successfully',
        raw: 'Verify "Leave application submitted successfully" is shown',
      },
      confidence: 'HIGH',
      diagnostics: [],
      resolved: {
        kind: 'verify',
        description:
          'expect(page.getByText("Leave application submitted successfully")).toBeVisible()',
        detail: 'Leave application submitted successfully',
      },
    },
  ],
};

test.describe(`Generation — code generator ${TAGS.SMOKE}`, () => {
  test('generates a spec file under applications/hrms/tests/ui/generated/', () => {
    const generated = generateSpecFile(SPEC);
    expect(generated.filePath).toContain('applications/hrms/tests/ui/generated/');
    expect(generated.filePath).toMatch(
      /leave-\d{2}-employee-can-apply-leave-via-code-generator-test\.spec\.ts$/,
    );
  });

  test('reuses the existing login helper instead of generating inline login', () => {
    const { code } = generateSpecFile(SPEC);
    expect(code).toContain("import { loginAsHrmsUser } from '../../../fixtures/hrms-auth'");
    expect(code).toContain('await loginAsHrmsUser(page, ui, profile.employee);');
  });

  test('uses the real base.fixture/TAGS/data-profile/execution-context framework imports', () => {
    const { code } = generateSpecFile(SPEC);
    expect(code).toContain("from '../../../../../src/core/fixtures/base.fixture'");
    expect(code).toContain("from '../../../../../src/core/constants'");
    expect(code).toContain("from '../../../../../src/core/execution/data-profile'");
    expect(code).toContain("from '../../../../../src/core/execution/execution-context'");
  });

  test('tags include application/module/generated/requirement AND the stable test id coverage relies on', () => {
    const { code, stableTestId } = generateSpecFile(SPEC);
    expect(stableTestId).toMatch(/^hrms\.leave\.generated\.\d+$/);
    expect(code).toContain("'@application.hrms'");
    expect(code).toContain("'@module.leave'");
    expect(code).toContain("'@generated'");
    expect(code).toContain("'@requirement.LEAVE-999'");
    expect(code).toContain(`'@${stableTestId}'`);
  });

  test('date markers become a computed relative date, never a hardcoded literal', () => {
    const { code } = generateSpecFile(SPEC);
    expect(code).toContain('const startDate = new Date(Date.now() +');
    expect(code).not.toContain("'{{date:start}}'");
  });

  test('never invents an action for a step it has no resolution for', () => {
    const unmappedSpec: TestSpecification = {
      ...SPEC,
      steps: [
        {
          step: { action: 'click', target: 'Mystery Button', raw: 'Click Mystery Button' },
          confidence: 'LOW',
          diagnostics: [],
          unmapped: { reason: 'not found' },
        },
      ],
    };
    expect(() => generateSpecFile(unmappedSpec)).toThrow(
      /Cannot generate code for an unmapped step/,
    );
  });

  test('a role-resolved verify step (bare "Verify confirmation is displayed") generates a getByRole assertion, not getByText', () => {
    const roleVerifySpec: TestSpecification = {
      ...SPEC,
      steps: [
        ...SPEC.steps.slice(0, -1),
        {
          step: { action: 'verify', raw: 'Verify confirmation is displayed' },
          confidence: 'HIGH',
          diagnostics: [],
          resolved: {
            kind: 'verify',
            strategy: 'role',
            confidence: 'HIGH',
            resolvedLocator: "getByRole('alert')",
            description: "expect(page.getByRole('alert')).toBeVisible()",
            detail: 'alert',
          },
        },
      ],
    };
    const { code } = generateSpecFile(roleVerifySpec);
    expect(code).toContain('await expect(page.getByRole("alert")).toBeVisible();');
    expect(code).not.toContain('getByText');
  });

  test('a plain UI verify (role-based, bare) never captures or depends on the submit response — the UI is its own oracle', () => {
    // A bare "Verify confirmation is displayed" is a UI business
    // requirement's oracle: what the UI shows, not an unrelated network
    // status. Capturing/asserting on submitResponse here would fail the
    // test on an irrelevant non-2xx even when the UI itself is fine to
    // assert against directly — see the 'verify-api' test below for the
    // one case that legitimately does depend on the network.
    const roleVerifySpec: TestSpecification = {
      ...SPEC,
      steps: [
        ...SPEC.steps.slice(0, -1),
        {
          step: { action: 'verify', raw: 'Verify confirmation is displayed' },
          confidence: 'HIGH',
          diagnostics: [],
          resolved: {
            kind: 'verify',
            strategy: 'role',
            confidence: 'HIGH',
            resolvedLocator: "getByRole('alert')",
            description: "expect(page.getByRole('alert')).toBeVisible()",
            detail: 'alert',
          },
        },
      ],
    };
    const { code } = generateSpecFile(roleVerifySpec);
    expect(code).not.toContain('submitResponse');
    expect(code).not.toContain('waitForResponse');
    expect(code).toContain('await ui.click("Submit Application");');
    expect(code).toContain('await expect(page.getByRole("alert")).toBeVisible();');
  });

  test('an EXPLICIT "verify-api" step (requirement asked for a network status) does capture the submit response and assert its status', () => {
    // The one case that legitimately depends on the network — but only
    // ever reached when the requirement text itself named an HTTP status
    // (requirement-parser.ts's API_STATUS_PATTERN), never auto-injected
    // for a plain UI verify.
    const apiVerifySpec: TestSpecification = {
      ...SPEC,
      steps: [
        ...SPEC.steps.slice(0, -1),
        {
          step: { action: 'verify', value: '{{api:201}}', raw: 'Verify API returns 201' },
          confidence: 'HIGH',
          diagnostics: [],
          resolved: {
            kind: 'verify-api',
            description: 'expect(submitResponse.status()).toBe(201)',
            detail: '201',
          },
        },
      ],
    };
    const { code } = generateSpecFile(apiVerifySpec);
    // Each generated step now runs inside its own liveStep()/test.step()
    // callback (see live-step.ts) — a separate function scope — so the
    // submit click assigns an outer `let submitResponse` rather than
    // declaring its own `const`, which a later verify-api step's callback
    // could not otherwise see.
    expect(code).toContain('let submitResponse: Response;');
    expect(code).toContain('const [response] = await Promise.all([');
    expect(code).toContain("page.waitForResponse((r) => r.request().method() !== 'GET'),");
    expect(code).toContain('submitResponse = response;');
    expect(code).toContain('expect(submitResponse.status()).toBe(201);');
    expect(code.indexOf('ui.click(')).toBeLessThan(code.indexOf('submitResponse.status()'));
  });

  test('a quoted-text verify is unaffected — no response capture, since exact expected text already discriminates success from failure', () => {
    const { code } = generateSpecFile(SPEC); // SPEC's own last step is a quoted-text verify
    expect(code).not.toContain('submitResponse');
    expect(code).not.toContain('waitForResponse');
    expect(code).toContain('await ui.click("Submit Application");');
  });

  test('every step — including the prepended navigation — is wrapped in its own liveStep() call, numbered from 1', () => {
    const { code } = generateSpecFile(SPEC);
    expect(code).toContain(
      "import { liveStep } from '../../../../../src/core/execution/live-step';",
    );
    expect(code).toContain('await liveStep("Login as employee", 1, page, async () => {');
    expect(code).toContain('await liveStep("Open Apply Leave", 2, page, async () => {');
    expect(code).toContain('await liveStep("Select start and end dates", 3, page, async () => {');
    expect(code).toContain(
      'await liveStep("Fill Reason as \\"Family trip\\"", 4, page, async () => {',
    );
    expect(code).toContain('await liveStep("Submit the request", 5, page, async () => {');
  });

  test('a spec whose first step does not already navigate gets a liveStep-wrapped "Open the application" goto as step 1', () => {
    const noNavSpec: TestSpecification = {
      ...SPEC,
      steps: SPEC.steps.slice(2), // drop login-helper/navigate — first step becomes a plain fill
    };
    const { code } = generateSpecFile(noNavSpec);
    expect(code).toContain('await liveStep("Open the application", 1, page, async () => {');
    expect(code).toContain('await liveStep("Select start and end dates", 2, page, async () => {');
  });

  test('the next generated index is the highest existing index + 1, not a count — surviving gaps from deleted files', () => {
    // A count-based index collides the moment an earlier file is deleted
    // (e.g. -01 and -03 exist, -02 was removed: count=2 -> "next" index 3
    // collides with the -03 file that's still on disk). Uses an isolated
    // module name so this never touches real generated files.
    const module = `gapindextest${Date.now()}`;
    const dir = path.resolve(process.cwd(), 'applications/hrms/tests/ui/generated');
    fs.mkdirSync(dir, { recursive: true });
    const gapFile1 = path.join(dir, `${module}-01-x.spec.ts`);
    const gapFile3 = path.join(dir, `${module}-03-x.spec.ts`);
    fs.writeFileSync(gapFile1, '');
    fs.writeFileSync(gapFile3, '');

    try {
      const generated = generateSpecFile({ ...SPEC, module });
      expect(generated.filePath).toMatch(new RegExp(`${module}-04-`));
    } finally {
      fs.rmSync(gapFile1, { force: true });
      fs.rmSync(gapFile3, { force: true });
    }
  });
});
