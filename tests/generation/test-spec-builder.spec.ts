import { test, expect } from '../../src/core/fixtures/base.fixture';
import { buildTestSpecification } from '../../src/core/generation/test-spec-builder';
import { parseRequirement } from '../../src/core/generation/requirement-parser';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { ApplicationMap } from '../../src/core/discovery/discovery-types';
import { TAGS } from '../../src/core/constants';

const VERIFIED = { strategy: 'role' as const, confidence: 'HIGH' as const, resolvedLocator: 'x' };

// Uses the real "hrms" application (already registered in
// config/applications.json) so module inference resolves against its
// real ["auth","leave","approval"] module list, and requirement-id
// sequencing continues the real applications/hrms/requirements/
// requirements.json numbering — these are the same real inputs
// production use would see, not a synthetic double.
const MAP: ApplicationMap = {
  application: 'hrms',
  baseUrl: 'http://localhost:4100',
  generatedAt: '2026-01-01T00:00:00.000Z',
  errors: [],
  pages: [
    {
      path: '/apply-leave.html',
      url: 'http://localhost:4100/apply-leave.html',
      title: 'Apply Leave',
      pageName: 'Apply Leave',
      headings: [],
      buttons: [{ role: 'button', name: 'Submit Application', verified: VERIFIED }],
      links: [],
      inputs: [{ role: 'textbox', name: 'Reason', verified: VERIFIED }],
      selects: [],
      checkboxes: [],
      tables: 0,
      forms: 0,
      navigation: 0,
      testIds: [],
      confirmationRegions: [{ role: 'alert', unique: true }],
      ariaSnapshot: '',
    },
  ],
};

test.describe(`Generation — test specification builder ${TAGS.SMOKE}`, () => {
  test('infers the module from a mapped navigate step naming a registered module', () => {
    const parsed = parseRequirement('Employee should be able to apply leave.\nOpen Apply Leave.');
    const mappings = mapRequirementToUI('hrms', MAP, parsed.steps);
    const spec = buildTestSpecification(parsed, mappings, { application: 'hrms' });
    expect(spec.module).toBe('leave');
  });

  test('an explicit --module override wins over inference', () => {
    const parsed = parseRequirement('Employee should be able to log in.');
    const spec = buildTestSpecification(parsed, [], { application: 'hrms', module: 'auth' });
    expect(spec.module).toBe('auth');
  });

  test('throws a clear error when the module cannot be determined at all', () => {
    const parsed = parseRequirement('Employee should be able to do something.');
    expect(() => buildTestSpecification(parsed, [], { application: 'hrms' })).toThrow(
      /Could not determine which module/,
    );
  });

  test('requirement id continues the real per-module sequence already in requirements.json (LEAVE-00N)', () => {
    const parsed = parseRequirement('Employee should be able to apply leave.\nOpen Apply Leave.');
    const mappings = mapRequirementToUI('hrms', MAP, parsed.steps);
    const spec = buildTestSpecification(parsed, mappings, { application: 'hrms' });
    expect(spec.requirementId).toMatch(/^LEAVE-\d{3}$/);
    expect(spec.requirementId).not.toBe('LEAVE-001'); // that id is already taken by a hand-written requirement
  });

  test('records a precondition when a login step is present, and expectedResults from verify steps', () => {
    const parsed = parseRequirement(
      'Employee should be able to apply leave.\nLogin as employee.\nVerify "Done" is shown.',
    );
    const mappings = mapRequirementToUI('hrms', MAP, parsed.steps);
    const spec = buildTestSpecification(parsed, mappings, { application: 'hrms', module: 'leave' });
    expect(spec.preconditions).toEqual(['User is authenticated']);
    expect(spec.expectedResults).toEqual(['Done']);
  });

  test('a bare (unquoted) verify step that resolves against a discovered confirmation region still produces a real expectedResults entry', () => {
    const parsed = parseRequirement(
      'Employee should be able to apply leave.\nOpen Apply Leave.\nVerify confirmation is displayed.',
    );
    const mappings = mapRequirementToUI('hrms', MAP, parsed.steps);
    const spec = buildTestSpecification(parsed, mappings, { application: 'hrms', module: 'leave' });
    expect(mappings[1].resolved?.detail).toBe('alert'); // sanity: it actually resolved
    expect(spec.expectedResults).toEqual(['confirmation is displayed']);
  });

  test('a bare verify step that could NOT be mapped does not appear in expectedResults at all', () => {
    const parsed = parseRequirement(
      'Employee should be able to apply leave.\nVerify confirmation.',
    );
    const mappings = mapRequirementToUI('hrms', MAP, parsed.steps);
    const spec = buildTestSpecification(parsed, mappings, { application: 'hrms', module: 'leave' });
    expect(mappings[0].resolved).toBeUndefined(); // no page context — genuinely unmapped
    expect(spec.expectedResults).toEqual([]);
  });

  test('defaults test type to "functional"', () => {
    const parsed = parseRequirement('Employee should be able to apply leave.');
    const spec = buildTestSpecification(parsed, [], { application: 'hrms', module: 'leave' });
    expect(spec.type).toBe('functional');
  });
});
