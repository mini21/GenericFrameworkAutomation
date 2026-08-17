import { test, expect } from '../../src/core/fixtures/base.fixture';
import { parseStructuredInput } from '../../src/core/intent/structured-parser';
import { ApplicationRegistry } from '../../src/core/config/application-registry';
import { TAGS } from '../../src/core/constants';

const REGISTRY: ApplicationRegistry = {
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
};

test.describe(`Structured Input Parser — Phase 2 ${TAGS.SMOKE}`, () => {
  test('parses the target field: value block with no ambiguity, same result as natural language', () => {
    const { intent, errors } = parseStructuredInput(
      ['application: HRMS', 'environment: QA', 'module: Leave', 'type: Smoke', 'browser: Chrome'],
      REGISTRY,
    );
    expect(errors).toEqual([]);
    expect(intent.application).toBe('hrms');
    expect(intent.environment).toBe('qa');
    expect(intent.module).toBe('leave');
    expect(intent.type).toBe('smoke');
    expect(intent.browsers).toEqual(['chromium']);
  });

  test('accepts field aliases and comma-separated browsers/tags', () => {
    const { intent, errors } = parseStructuredInput(
      [
        'app: hrms',
        'env: qa',
        'browsers: chrome, firefox',
        'tags: @smoke, @hrms.leave.apply.valid',
      ],
      REGISTRY,
    );
    expect(errors).toEqual([]);
    expect(intent.browsers?.slice().sort()).toEqual(['chromium', 'firefox']);
    expect(intent.tags).toEqual(['@smoke', '@hrms.leave.apply.valid']);
  });

  test('rejects an unknown application with a friendly, listable error', () => {
    const { errors, intent } = parseStructuredInput(['application: DoesNotExist'], REGISTRY);
    expect(intent.application).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Unknown application "DoesNotExist"');
    expect(errors[0]).toContain('hrms');
  });

  test('rejects an unknown environment', () => {
    const { errors } = parseStructuredInput(['environment: moon'], REGISTRY);
    expect(errors[0]).toContain('Unknown environment "moon"');
  });

  test('rejects an unknown test type', () => {
    const { errors } = parseStructuredInput(['type: load'], REGISTRY);
    expect(errors[0]).toContain('Unknown test type "load"');
  });

  test('rejects an unknown browser', () => {
    const { errors } = parseStructuredInput(['browser: netscape'], REGISTRY);
    expect(errors[0]).toContain('Unknown browser "netscape"');
  });

  test('rejects an unrecognized field name', () => {
    const { errors } = parseStructuredInput(['color: blue'], REGISTRY);
    expect(errors[0]).toContain('Unknown field "color"');
  });

  test('rejects a line with no "field: value" shape', () => {
    const { errors } = parseStructuredInput(['just some text'], REGISTRY);
    expect(errors[0]).toContain('Could not understand line');
  });
});
