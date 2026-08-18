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

  test('a bare "Verify ..." sentence with no quoted text is recognized as a verify step, not silently dropped', () => {
    const { steps } = parseRequirement(
      'Login as employee.\nSubmit the leave request.\nVerify confirmation is displayed.',
    );
    expect(steps).toEqual([
      { action: 'login', target: 'employee', raw: 'Login as employee' },
      { action: 'click', target: 'submit', raw: 'Submit the leave request' },
      { action: 'verify', raw: 'Verify confirmation is displayed' },
    ]);
  });

  test('other bare verify phrasings ("Verify confirmation.", "Check status is Approved") are also recognized, not dropped', () => {
    const { steps: shortForm } = parseRequirement('Verify confirmation.');
    expect(shortForm).toEqual([{ action: 'verify', raw: 'Verify confirmation' }]);

    const { steps: checkForm } = parseRequirement('Check status is Approved.');
    expect(checkForm).toEqual([{ action: 'verify', raw: 'Check status is Approved' }]);
  });

  test('"Select start date."/"Select end date." as separate sentences use the same safe date marker as the combined phrasing', () => {
    const { steps } = parseRequirement('Select start date.\nSelect end date.');
    expect(steps).toEqual([
      { action: 'fill', target: 'Start Date', value: '{{date:start}}', raw: 'Select start date' },
      { action: 'fill', target: 'End Date', value: '{{date:end}}', raw: 'Select end date' },
    ]);
  });

  test('a field named with no value ("Enter reason") is surfaced as needing clarification, not silently dropped and not guessed', () => {
    const { steps, needsClarification } = parseRequirement(
      'Login as employee.\nEnter reason.\nSubmit the leave request.',
    );
    // Never turned into a fill step with an invented/empty value:
    expect(steps.some((s) => s.action === 'fill')).toBe(false);
    expect(needsClarification).toEqual([{ raw: 'Enter reason', field: 'reason' }]);
  });

  test('once the missing value is supplied, re-parsing with it substituted in produces a real, quoted fill step', () => {
    const { needsClarification } = parseRequirement('Enter reason.');
    const [{ field, raw }] = needsClarification;
    const rewritten = 'Enter reason.'.replace(raw, `Fill ${field} as "Family trip"`);
    const { steps, needsClarification: stillMissing } = parseRequirement(rewritten);
    expect(stillMissing).toEqual([]);
    expect(steps).toEqual([
      {
        action: 'fill',
        target: 'reason',
        value: 'Family trip',
        raw: 'Fill reason as "Family trip"',
      },
    ]);
  });

  test('an EXPLICIT network/API assertion ("Verify API returns 201", "Verify POST /leave returns 201") is recognized distinctly from a plain UI verify', () => {
    const { steps: generic } = parseRequirement('Verify API returns 201.');
    expect(generic).toEqual([
      { action: 'verify', value: '{{api:201}}', raw: 'Verify API returns 201' },
    ]);

    const { steps: withMethodAndPath } = parseRequirement('Verify POST /leave returns 201.');
    expect(withMethodAndPath).toEqual([
      { action: 'verify', value: '{{api:201}}', raw: 'Verify POST /leave returns 201' },
    ]);

    const { steps: responseIs } = parseRequirement('Verify API response is 201.');
    expect(responseIs).toEqual([
      { action: 'verify', value: '{{api:201}}', raw: 'Verify API response is 201' },
    ]);
  });

  test('a plain "Verify confirmation" / "Verify status is Approved" never gets mistaken for an API assertion (no digits, no marker)', () => {
    const { steps: confirmation } = parseRequirement('Verify confirmation is displayed.');
    expect(confirmation).toEqual([{ action: 'verify', raw: 'Verify confirmation is displayed' }]);

    const { steps: statusApproved } = parseRequirement('Verify status is Approved.');
    expect(statusApproved).toEqual([{ action: 'verify', raw: 'Verify status is Approved' }]);
  });
});
