import { test, expect } from '../../src/core/fixtures/base.fixture';
import { resolveExecution, toPlaywrightArgs } from '../../src/core/execution/execution-resolver';
import { TAGS } from '../../src/core/constants';

test.describe(`Execution — resolver ${TAGS.SMOKE}`, () => {
  test('explicit --tags run exactly what was asked — @smoke is never ANDed in on top', () => {
    const resolved = resolveExecution({
      cli: { application: 'hrms', environment: 'qa', tags: ['@hrms.leave.generated.11'] },
    });

    expect(resolved.tags).toEqual(['@hrms.leave.generated.11']);

    const args = toPlaywrightArgs(resolved);
    expect(args).toContain('--grep=(?=.*@hrms\\.leave\\.generated\\.11)');
    expect(args.find((a) => a.startsWith('--grep='))).not.toContain('@smoke');
  });

  test('no --tags and no --type still defaults to the smoke run (existing behavior preserved)', () => {
    const resolved = resolveExecution({ cli: { application: 'hrms', environment: 'qa' } });

    expect(resolved.tags).toEqual(['@smoke']);
    expect(toPlaywrightArgs(resolved)).toContain('--grep=(?=.*@smoke)');
  });

  test('an explicit --type is still ANDed with explicit --tags — narrowing is preserved when the user asks for both', () => {
    const resolved = resolveExecution({
      cli: {
        application: 'hrms',
        environment: 'qa',
        type: 'regression',
        tags: ['@hrms.leave.generated.11'],
      },
    });

    expect(resolved.tags.sort()).toEqual(['@hrms.leave.generated.11', '@regression'].sort());
  });

  test('GAP_TAGS env var behaves the same as --tags — no smoke pollution', () => {
    const resolved = resolveExecution({
      cli: { application: 'hrms', environment: 'qa' },
      env: { GAP_TAGS: '@hrms.leave.generated.11' },
    });

    expect(resolved.tags).toEqual(['@hrms.leave.generated.11']);
  });
});
