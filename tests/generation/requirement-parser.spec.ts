import { test, expect } from '../../src/core/fixtures/base.fixture';
import { parseRequirement } from '../../src/core/generation/requirement-parser';
import { TAGS } from '../../src/core/constants';

test.describe(`Generation — requirement parser ${TAGS.SMOKE}`, () => {
  test('parses a full multi-line requirement into the expected step sequence', () => {
    const { steps, testNameHint } = parseRequirement(
      [
        'Employee should be able to apply leave.',
        'Login as employee.',
        'Open Apply Leave.',
        'Select start and end dates.',
        'Fill Reason as "Family trip".',
        'Submit the request.',
        'Verify "Leave application submitted successfully" is shown.',
      ].join('\n'),
    );

    expect(testNameHint).toBe('employee can apply leave');
    expect(steps).toEqual([
      { action: 'login', target: 'employee', raw: 'Login as employee' },
      { action: 'navigate', target: 'Apply Leave', raw: 'Open Apply Leave' },
      {
        action: 'fill',
        target: 'Start Date',
        value: '{{date:start}}',
        raw: 'Select start and end dates',
      },
      {
        action: 'fill',
        target: 'End Date',
        value: '{{date:end}}',
        raw: 'Select start and end dates',
      },
      {
        action: 'fill',
        target: 'Reason',
        value: 'Family trip',
        raw: 'Fill Reason as "Family trip"',
      },
      { action: 'click', target: 'submit', raw: 'Submit the request' },
      {
        action: 'verify',
        value: 'Leave application submitted successfully',
        raw: 'Verify "Leave application submitted successfully" is shown',
      },
    ]);
  });

  test('accepts sentences separated by ". " on a single line, not just newlines', () => {
    const { steps } = parseRequirement('Login as manager. Open Approvals. Click Approve.');
    expect(steps.map((s) => s.action)).toEqual(['login', 'navigate', 'click']);
    expect(steps[0].target).toBe('manager');
  });

  test('a bare goal-only requirement with no recognizable step verbs yields zero steps', () => {
    const { steps } = parseRequirement('Employee should be able to apply leave.');
    expect(steps).toEqual([]);
  });

  test('a sentence matching no known pattern is silently dropped, not force-mapped', () => {
    const { steps } = parseRequirement(
      'Login as employee.\nDo something vague.\nSubmit the request.',
    );
    expect(steps.map((s) => s.action)).toEqual(['login', 'click']);
  });

  test('select "value" for field is recognized with value/target swapped correctly', () => {
    const { steps } = parseRequirement('Select "Casual Leave" for Leave Type.');
    expect(steps).toEqual([
      {
        action: 'fill',
        target: 'Leave Type',
        value: 'Casual Leave',
        raw: 'Select "Casual Leave" for Leave Type',
      },
    ]);
  });

  test('"should be able to" is turned into a "can" test name, matching hand-written naming convention', () => {
    const { testNameHint } = parseRequirement('Manager should be able to reject leave.');
    expect(testNameHint).toBe('manager can reject leave');
  });
});
