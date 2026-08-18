import { test, expect } from '../../src/core/fixtures/base.fixture';
import { generateSpecFile } from '../../src/core/generation/code-generator';
import {
  writeGeneratedFile,
  deleteGeneratedFile,
} from '../../src/core/generation/generation-writer';
import { runGeneratedTest } from '../../src/core/generation/generated-test-validator';
import { TestSpecification } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

/**
 * Reproduces the reported "loginAsHrmsUser() -> Username not found" defect
 * end to end, for real: generates an actual spec file, writes it to disk,
 * and RUNS it through the exact same execution engine (runGeneratedTest)
 * `gap:generate` itself uses for validation — real browser, real HRMS
 * server (started automatically by playwright.config.ts's webServer, the
 * same guarantee every hand-written HRMS test already relies on), real
 * BASE_URL resolution. Not a mock of any of these — if BASE_URL, the
 * login/start path, or LocatorResolver's Username/Password resolution
 * were ever wrong again, this test would fail exactly like the reported
 * generated tests did.
 */
const LOGIN_SPEC: TestSpecification = {
  requirementId: 'AUTH-999',
  requirementText: 'Employee should be able to log in.',
  testName: 'generated auth regression can log in',
  application: 'hrms',
  module: 'auth',
  type: 'functional',
  preconditions: [],
  expectedResults: [],
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
  ],
};

test.describe(`Generation — generated-test runtime authentication ${TAGS.SMOKE}`, () => {
  test("a freshly generated HRMS test explicitly navigates to the application's registered start path before loginAsHrmsUser(), using real config, not a hardcoded path", () => {
    const { code } = generateSpecFile(LOGIN_SPEC);
    // config/applications.json's hrms.startPath — never a literal path
    // written into code-generator.ts itself.
    expect(code).toContain('await page.goto("/login.html");');
    expect(code).toContain('await loginAsHrmsUser(page, ui, profile.employee);');
    // The explicit goto must come BEFORE the helper call, not after.
    expect(code.indexOf('page.goto("/login.html")')).toBeLessThan(code.indexOf('loginAsHrmsUser('));
  });

  test('that generated test, actually executed against the real HRMS server, resolves Username/Password and logs in successfully — the reported defect, reproduced and proven fixed', async () => {
    const generated = generateSpecFile(LOGIN_SPEC);
    writeGeneratedFile(generated.filePath, generated.code);
    try {
      const result = runGeneratedTest('hrms', 'qa', generated.filePath);
      expect(result.passed, `Generated auth test failed:\n${result.output}`).toBe(true);
      expect(result.output).not.toContain('Could not resolve');
      expect(result.output).not.toContain('Username not found');
    } finally {
      deleteGeneratedFile(generated.filePath);
    }
  });
});
