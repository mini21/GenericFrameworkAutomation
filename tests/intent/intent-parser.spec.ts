import { test, expect } from '../../src/core/fixtures/base.fixture';
import { parseIntent } from '../../src/core/intent/intent-parser';
import { ApplicationRegistry } from '../../src/core/config/application-registry';
import { TAGS } from '../../src/core/constants';

// A synthetic two-application registry, injected via parseIntent's optional
// second argument — lets us exercise application-level ambiguity without
// touching the real config/applications.json (which only has one app today).
const TWO_APP_REGISTRY: ApplicationRegistry = {
  hrms: {
    name: 'HRMS Leave Management',
    baseUrl: 'http://localhost:4100',
    apiBaseUrl: 'http://localhost:4100',
    modules: ['auth', 'leave', 'approval'],
    authProfiles: ['employee', 'manager'],
    defaultBrowser: 'chromium',
    supportedBrowsers: ['chromium', 'firefox', 'webkit'],
    dataProfiles: ['qa-default'],
  },
  abc: {
    name: 'ABC Portal',
    baseUrl: 'http://localhost:4200',
    modules: ['login', 'leave', 'orders'],
    authProfiles: ['user'],
    defaultBrowser: 'chromium',
    supportedBrowsers: ['chromium'],
    dataProfiles: ['qa-default'],
  },
};

const SINGLE_APP_REGISTRY: ApplicationRegistry = { hrms: TWO_APP_REGISTRY.hrms };

test.describe(`Intent Parser — natural language ${TAGS.SMOKE}`, () => {
  test('matches the target example end-to-end with no ambiguity', () => {
    const { intent, ambiguities } = parseIntent(
      'Run smoke tests for Leave module in QA using Chrome',
      SINGLE_APP_REGISTRY,
    );
    expect(ambiguities).toEqual([]);
    expect(intent.application).toBe('hrms');
    expect(intent.environment).toBe('qa');
    expect(intent.module).toBe('leave');
    expect(intent.type).toBe('smoke');
    expect(intent.browsers).toEqual(['chromium']);
  });

  test('asks which application when a module name matches more than one app', () => {
    const { intent, ambiguities } = parseIntent(
      'Run smoke tests for Leave module in QA',
      TWO_APP_REGISTRY,
    );
    expect(intent.application).toBeUndefined();
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0].field).toBe('application');
    expect(ambiguities[0].options.map((o) => o.value).sort()).toEqual(['abc', 'hrms']);
  });

  test('naming the application resolves the earlier ambiguity', () => {
    const { intent, ambiguities } = parseIntent(
      'Run smoke tests for Leave module in QA for HRMS',
      TWO_APP_REGISTRY,
    );
    expect(ambiguities).toEqual([]);
    expect(intent.application).toBe('hrms');
    expect(intent.module).toBe('leave');
  });

  test('the REPL clarification loop: appending the chosen ambiguity value resolves the next parse', () => {
    const first = parseIntent('Run smoke tests for Leave module in QA', TWO_APP_REGISTRY);
    const chosen = first.ambiguities[0].options.find((o) => o.value === 'hrms');
    expect(chosen).toBeDefined();

    const second = parseIntent(
      `Run smoke tests for Leave module in QA ${chosen!.value}`,
      TWO_APP_REGISTRY,
    );
    expect(second.ambiguities).toEqual([]);
    expect(second.intent.application).toBe('hrms');
    expect(second.intent.module).toBe('leave');
  });

  test('asks which module when more than one module name is mentioned for the same application', () => {
    const { ambiguities } = parseIntent(
      'Run regression for HRMS covering leave and approval',
      TWO_APP_REGISTRY,
    );
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0].field).toBe('module');
    expect(ambiguities[0].options.map((o) => o.value).sort()).toEqual(['approval', 'leave']);
  });

  test('asks which environment when multiple environment keywords appear', () => {
    const { ambiguities } = parseIntent(
      'Run smoke tests for HRMS in staging and production',
      TWO_APP_REGISTRY,
    );
    const envAmbiguity = ambiguities.find((a) => a.field === 'environment');
    expect(envAmbiguity).toBeDefined();
    expect(envAmbiguity!.options.map((o) => o.value).sort()).toEqual(['prod', 'staging']);
  });

  test('asks which test type when multiple test-type keywords appear', () => {
    const { ambiguities } = parseIntent(
      'Run smoke and regression for HRMS leave',
      TWO_APP_REGISTRY,
    );
    expect(ambiguities.find((a) => a.field === 'type')).toBeDefined();
  });

  test('multiple browser mentions select multiple browsers rather than raising an ambiguity', () => {
    const { intent, ambiguities } = parseIntent(
      'Run smoke for HRMS leave in QA using Chrome and Firefox',
      TWO_APP_REGISTRY,
    );
    expect(ambiguities).toEqual([]);
    expect(intent.browsers?.slice().sort()).toEqual(['chromium', 'firefox']);
  });

  test('recognizes "all browsers"', () => {
    const { intent } = parseIntent(
      'Run regression for HRMS leave in QA on all browsers',
      TWO_APP_REGISTRY,
    );
    expect(intent.browsers).toEqual(['all']);
  });

  test('extracts explicit @tag tokens only', () => {
    const { intent } = parseIntent(
      'Run smoke for HRMS leave in QA @hrms.leave.apply.valid',
      TWO_APP_REGISTRY,
    );
    expect(intent.tags).toEqual(['@hrms.leave.apply.valid']);
  });

  test('leaves application undefined without crashing when no applications are registered', () => {
    const { intent, ambiguities } = parseIntent('run something', {});
    expect(intent.application).toBeUndefined();
    expect(ambiguities).toEqual([]);
  });

  test('an unrecognized "<word> module" mention is passed through rather than silently dropped', () => {
    // No app in the registry has a "payments" module — this must surface
    // downstream (validateIntent) as an error, not silently widen the run
    // to every module the way an absent/undetected module would.
    const { intent } = parseIntent(
      'Run smoke tests for Payments module in QA',
      SINGLE_APP_REGISTRY,
    );
    expect(intent.application).toBe('hrms');
    expect(intent.module).toBe('payments');
  });

  test('a bare mention with no "module" keyword and no registry match leaves module undefined', () => {
    const { intent } = parseIntent('Run smoke tests for Payments in QA', SINGLE_APP_REGISTRY);
    expect(intent.module).toBeUndefined();
  });
});
