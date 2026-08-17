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
});
