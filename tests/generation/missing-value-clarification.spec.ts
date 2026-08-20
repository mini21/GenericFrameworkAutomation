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
 * page.waitForResponse timeout — since fixed by asking for the value.
 *
 * Then fixes a SECOND, later-reported bug of the same shape: asking was
 * ALWAYS wired up unconditionally, including in the web UI's normal
 * (non-interactive) generation path — a caller with no human actually
 * watching for a question left the pipeline waiting on a Promise that
 * would never resolve ("stuck at Waiting for approval"). Normal
 * generation must resolve missing values from the application's own
 * test-data profile or fail safely — asking a human is now an explicit,
 * opt-in debug/interactive mode only (interactiveResolution: true), never
 * the default.
 */
test.describe(`Generation — missing-value clarification ${TAGS.SMOKE}`, () => {
  test('NORMAL (non-interactive) generation resolves a missing value from the application test-data profile automatically — no resolver called, no waiting', async () => {
    let resolveMissingValueCalled = false;
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
      // Wired up exactly like a real caller might leave one lying around —
      // must never actually be invoked in normal (non-interactive) mode.
      resolveMissingValue: async () => {
        resolveMissingValueCalled = true;
        return 'should never be used';
      },
    });

    expect(resolveMissingValueCalled).toBe(false);
    if (outcome.status === 'blocked') {
      throw new Error(
        `Expected the test-data profile value to resolve, got blocked: ${outcome.message}`,
      );
    }
    expect(outcome.status).toBe('ready-for-approval');
    // From applications/hrms/data/qa-default.json's own "reason": { "value": "Family trip" }
    // — never invented, never asked for.
    expect(
      outcome.spec.steps.some(
        (s) => s.resolved?.description === "ui.fill('Reason', 'Family trip')",
      ),
    ).toBe(true);
    rejectGeneration(outcome); // never save a test this spec didn't explicitly approve
  });

  test('NORMAL generation with NO test-data profile entry fails safely — never asks, never guesses, even with a resolver wired up', async () => {
    let resolveMissingValueCalled = false;
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: [
        'Employee should be able to apply leave.',
        'Login as employee.',
        'Open Apply Leave.',
        // No test-data profile entry exists for this field.
        'Enter a field with no configured value whatsoever.',
      ].join('\n'),
      resolveMissingValue: async () => {
        resolveMissingValueCalled = true;
        return 'should never be used';
      },
    });

    expect(resolveMissingValueCalled).toBe(false);
    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.message).toContain('never guessed');
      expect(outcome.message).toContain('no test-data value configured');
    }
  });

  test('leaving the missing value unresolved (no profile entry, no interactive resolver at all) blocks clearly', async () => {
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: [
        'Employee should be able to apply leave.',
        'Login as employee.',
        'Open Apply Leave.',
        'Enter a field with no configured value whatsoever.',
      ].join('\n'),
    });

    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.message).toContain('never guessed');
    }
  });

  test('EXPLICIT interactive/debug mode (interactiveResolution: true) still asks when the test-data profile has nothing — isolated from, and never required for, normal generation', async () => {
    // A field with no test-data profile entry — normal mode would block
    // immediately (see the test above) without ever calling the resolver.
    // With interactiveResolution: true, the SAME resolver IS called.
    let resolveMissingValueCalled = false;
    let calledWithField = '';
    const outcome = await runGenerationPipeline({
      application: 'hrms',
      environment: 'qa',
      requirementText: [
        'Employee should be able to apply leave.',
        'Login as employee.',
        'Open Apply Leave.',
        'Enter a field with no configured value whatsoever.',
      ].join('\n'),
      interactiveResolution: true,
      resolveMissingValue: async (field) => {
        resolveMissingValueCalled = true;
        calledWithField = field;
        return undefined; // declines to answer — still proves the call happened, without needing a real matching element to reach 'ready-for-approval'
      },
    });

    expect(resolveMissingValueCalled).toBe(true);
    expect(calledWithField).toBe('a field with no configured value whatsoever');
    // Declined answer -> still blocked, but via the SAME honest "never
    // guessed" path as normal mode — interactive mode never fabricates
    // a value just because a human was asked and didn't answer.
    expect(outcome.status).toBe('blocked');
  });
});
