import { test, expect } from '../../src/core/fixtures/base.fixture';
import { parseIntent } from '../../src/core/intent/intent-parser';
import {
  validateIntent,
  finalize,
  formatPlan,
  GapUserError,
} from '../../src/core/intent/intent-resolver';
import { resolveExecution } from '../../src/core/execution/execution-resolver';
import { TestType } from '../../src/core/execution/execution-manifest';
import { TAGS } from '../../src/core/constants';

// These tests use the REAL application registry (config/applications.json)
// on purpose: they exist to prove the natural-language and
// structured-input layers hand off into the EXISTING GAP execution
// engine unchanged — no second execution engine, no bypassed validation.
test.describe(`Intent Resolver — reaches the existing GAP execution engine ${TAGS.SMOKE}`, () => {
  test('a natural-language request resolves to exactly what the equivalent CLI flags would produce', () => {
    const { intent, ambiguities } = parseIntent(
      'Run smoke tests for Leave module in QA using Chrome',
    );
    expect(ambiguities).toEqual([]);

    const outcome = finalize(intent);
    const direct = resolveExecution({
      cli: {
        application: 'hrms',
        environment: 'qa',
        module: 'leave',
        type: 'smoke',
        browsers: ['chromium'],
      },
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolved).toEqual(direct);
    }
  });

  test('an unknown application surfaces the existing registry error unchanged', () => {
    const outcome = finalize({ application: 'not-a-real-app' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('Unknown application "not-a-real-app"');
      expect(outcome.message).toContain('hrms');
    }
  });

  test('a natural-language request naming a module the application does not have fails clearly rather than running every module', () => {
    // Names the application explicitly ("hrms") — with more than one
    // application now registered (amazon joined hrms once the web UI's
    // acceptance test onboarded it), an unnamed application is a genuine,
    // correct ambiguity (see intent-parser.ts's matchApplications/
    // appsFromModule fallback chain), not something this test should
    // paper over. Naming it keeps this test's actual point intact: an
    // application's own module list is still checked strictly.
    const { intent, ambiguities } = parseIntent('Run smoke tests for Payments module in HRMS QA');
    expect(ambiguities).toEqual([]);
    const outcome = finalize(intent);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('Application "hrms" has no module "payments"');
    }
  });

  test('rejects an invalid environment before reaching the execution engine', () => {
    expect(() => validateIntent({ environment: 'moon' })).toThrow(GapUserError);
    expect(() => validateIntent({ environment: 'moon' })).toThrow(/Unknown environment "moon"/);
  });

  test('rejects an invalid test type before reaching the execution engine', () => {
    expect(() => validateIntent({ type: 'load' as TestType })).toThrow(GapUserError);
  });

  test('rejects a module that does not belong to the resolved application', () => {
    expect(() => validateIntent({ application: 'hrms', module: 'payments' })).toThrow(
      /Application "hrms" has no module "payments"/,
    );
  });

  test('a valid module for the resolved application passes validation', () => {
    expect(() => validateIntent({ application: 'hrms', module: 'leave' })).not.toThrow();
  });

  test('formatPlan renders a human-readable, QA-facing summary', () => {
    const resolved = resolveExecution({
      cli: {
        application: 'hrms',
        environment: 'qa',
        module: 'leave',
        type: 'smoke',
        browsers: ['chromium'],
      },
    });
    const text = formatPlan(resolved);
    expect(text).toContain('Application: HRMS Leave Management (hrms)');
    expect(text).toContain('Environment: QA');
    expect(text).toContain('Module:      leave');
    expect(text).toContain('Test Type:   smoke');
    expect(text).toContain('Browser(s):  chromium');
  });
});
