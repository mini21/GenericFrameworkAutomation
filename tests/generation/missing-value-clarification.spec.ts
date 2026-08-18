import { test, expect } from '../../src/core/fixtures/base.fixture';
import {
  runGenerationPipeline,
  rejectGeneration,
} from '../../src/core/generation/generation-orchestrator';
import { TAGS } from '../../src/core/constants';

/**
 * Reproduces the reported failure end to end: "Enter reason." (no value)
 * used to be silently dropped, so the generated test submitted an
 * incomplete form and only failed 10+ seconds later via a cryptic
 * page.waitForResponse timeout. This proves the fix actually resolves it —
 * a supplied value re-parses in as a real, quoted fill step and the
 * pipeline reaches real, successful execution — not just that the
 * parser-level unit test passes in isolation.
 */
test.describe(`Generation — missing-value clarification ${TAGS.SMOKE}`, () => {
  test('a resolveMissingValue answer lets a bare "Enter reason." requirement actually reach successful execution', async () => {
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: [
        'Employee should be able to apply leave.',
        'Login as employee.',
        'Open Apply Leave.',
        'Select start and end dates.',
        'Enter reason.',
        'Submit the leave request.',
      ].join('\n'),
      resolveMissingValue: async () => 'Family trip',
    });

    if (outcome.status === 'blocked') {
      throw new Error(`Expected the missing value to resolve, got blocked: ${outcome.message}`);
    }
    expect(outcome.status).toBe('ready-for-approval');
    expect(
      outcome.spec.steps.some(
        (s) => s.resolved?.description === "ui.fill('Reason', 'Family trip')",
      ),
    ).toBe(true);
    rejectGeneration(outcome); // never save a test this spec didn't explicitly approve
  });

  test('leaving the missing value unanswered blocks clearly, still never guessing or fabricating a fill', async () => {
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: [
        'Employee should be able to apply leave.',
        'Login as employee.',
        'Open Apply Leave.',
        'Enter reason.',
      ].join('\n'),
      resolveMissingValue: async () => undefined,
    });

    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.message).toContain('never guessed');
      expect(outcome.message).toContain('"Enter reason"');
    }
  });
});
