import { test, expect } from '../../src/core/fixtures/base.fixture';
import { explainExecutionFailure } from '../../src/core/generation/generation-orchestrator';
import { TAGS } from '../../src/core/constants';

// Generic: matches on the shape Playwright itself produces for a timed-out
// waitForResponse, never on any application-specific text.
test.describe(`Generation — execution-failure diagnosis ${TAGS.SMOKE}`, () => {
  test('a timed-out waitForResponse (submit never fired a request) gets an actionable hint', () => {
    const output =
      'TimeoutError: page.waitForResponse: Timeout 10000ms exceeded while waiting for event "response"';
    const hint = explainExecutionFailure(output);
    expect(hint).toContain('never triggered a network request');
    expect(hint).toContain('quoted value');
  });

  test('an unrelated execution failure gets no hint appended', () => {
    expect(explainExecutionFailure('Error: expect(received).toBe(expected)')).toBeUndefined();
    expect(
      explainExecutionFailure('LocatorResolutionError: Could not resolve "Username"'),
    ).toBeUndefined();
  });
});
