import type { TestCase, TestResult, TestStep, FullResult } from '@playwright/test/reporter';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';
import LiveEventsReporter from '../../src/core/reporter/live-events-reporter';
import { parseLiveEventLine } from '../../src/core/execution/live-events';

/**
 * Unit-level coverage of the reporter that turns Playwright's own
 * onBegin/onTestBegin/onStepBegin/onStepEnd/onTestEnd/onEnd callbacks into
 * the structured GAP_LIVE_EVENT stdout protocol the web UI consumes (see
 * server/ui/routes.ts). Exercises the reporter directly against minimal
 * fake TestCase/TestStep/TestResult/FullResult objects rather than a real
 * spawned Playwright run — deterministic and fast, and it is the exact
 * same reporter instance/method calls a real run drives.
 */

function fakeTest(id = 'test-1'): TestCase {
  return { id } as unknown as TestCase;
}

function fakeStep(overrides: Record<string, unknown> = {}): TestStep {
  return {
    title: 'Enter "laptop" in the search box.',
    category: 'test.step',
    parent: undefined,
    duration: 420,
    error: undefined,
    ...overrides,
  } as unknown as TestStep;
}

function fakeResult(overrides: Record<string, unknown> = {}): TestResult {
  return { status: 'passed', duration: 0, ...overrides } as unknown as TestResult;
}

function fakeFullResult(overrides: Record<string, unknown> = {}): FullResult {
  return { status: 'passed', ...overrides } as unknown as FullResult;
}

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  return {
    lines,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

test.describe(`Live execution — reporter event emission ${TAGS.SMOKE}`, () => {
  test.afterEach(() => {
    delete process.env.GAP_RUN_ID;
    delete process.env.GAP_APPLICATION;
    delete process.env.GAP_REQUIREMENT;
  });

  test('emits RUN_STARTED on onBegin', () => {
    process.env.GAP_RUN_ID = 'run-1';
    const capture = captureStdout();
    new LiveEventsReporter().onBegin();
    capture.restore();
    const event = parseLiveEventLine(capture.lines[0].trim());
    expect(event?.type).toBe('RUN_STARTED');
    expect(event?.runId).toBe('run-1');
  });

  test('emits STEP_STARTED on onStepBegin for a test.step boundary', () => {
    process.env.GAP_RUN_ID = 'run-2';
    const reporter = new LiveEventsReporter();
    reporter.onTestBegin(fakeTest());
    const capture = captureStdout();
    reporter.onStepBegin(fakeTest(), fakeResult(), fakeStep());
    capture.restore();
    const event = parseLiveEventLine(capture.lines[0].trim());
    expect(event?.type).toBe('STEP_STARTED');
    expect(event?.stepIndex).toBe(1);
    expect(event?.stepDescription).toBe('Enter "laptop" in the search box.');
  });

  test('emits STEP_PASSED on onStepEnd for a successful step', () => {
    process.env.GAP_RUN_ID = 'run-3';
    const reporter = new LiveEventsReporter();
    reporter.onTestBegin(fakeTest());
    reporter.onStepBegin(fakeTest(), fakeResult(), fakeStep());
    const capture = captureStdout();
    reporter.onStepEnd(fakeTest(), fakeResult(), fakeStep());
    capture.restore();
    const event = parseLiveEventLine(capture.lines[0].trim());
    expect(event?.type).toBe('STEP_PASSED');
    expect(event?.status).toBe('passed');
    expect(event?.durationMs).toBe(420);
  });

  test('emits STEP_FAILED on onStepEnd for a failed step, carrying the error message', () => {
    process.env.GAP_RUN_ID = 'run-4';
    const reporter = new LiveEventsReporter();
    reporter.onTestBegin(fakeTest());
    reporter.onStepBegin(fakeTest(), fakeResult(), fakeStep());
    const capture = captureStdout();
    reporter.onStepEnd(
      fakeTest(),
      fakeResult(),
      fakeStep({ error: { message: 'Timeout waiting for locator' } }),
    );
    capture.restore();
    const event = parseLiveEventLine(capture.lines[0].trim());
    expect(event?.type).toBe('STEP_FAILED');
    expect(event?.status).toBe('failed');
    expect(event?.error).toBe('Timeout waiting for locator');
  });

  test('emits TEST_COMPLETED on onTestEnd', () => {
    process.env.GAP_RUN_ID = 'run-5';
    const capture = captureStdout();
    new LiveEventsReporter().onTestEnd(
      fakeTest(),
      fakeResult({ status: 'passed', duration: 1500 }),
    );
    capture.restore();
    const event = parseLiveEventLine(capture.lines[0].trim());
    expect(event?.type).toBe('TEST_COMPLETED');
    expect(event?.status).toBe('passed');
    expect(event?.durationMs).toBe(1500);
  });

  test('emits RUN_COMPLETED on onEnd', () => {
    process.env.GAP_RUN_ID = 'run-6';
    const capture = captureStdout();
    new LiveEventsReporter().onEnd(fakeFullResult({ status: 'passed' }));
    capture.restore();
    const event = parseLiveEventLine(capture.lines[0].trim());
    expect(event?.type).toBe('RUN_COMPLETED');
    expect(event?.status).toBe('passed');
  });

  test('emits TEST_CANCELLED/RUN_CANCELLED for an interrupted run — the SIGTERM cancel path (Job#cancel in jobs.ts)', () => {
    process.env.GAP_RUN_ID = 'run-7';
    const reporter = new LiveEventsReporter();
    const capture = captureStdout();
    reporter.onTestEnd(fakeTest(), fakeResult({ status: 'interrupted', duration: 300 }));
    reporter.onEnd(fakeFullResult({ status: 'interrupted' }));
    capture.restore();
    const events = capture.lines.map((l) => parseLiveEventLine(l.trim()));
    expect(events.map((e) => e?.type)).toEqual(['TEST_CANCELLED', 'RUN_CANCELLED']);
  });

  test('never writes to stdout when GAP_RUN_ID is unset — a true no-op for every normal CLI/CI run (existing report generation is unaffected)', () => {
    delete process.env.GAP_RUN_ID;
    const reporter = new LiveEventsReporter();
    const capture = captureStdout();
    reporter.onBegin();
    reporter.onTestBegin(fakeTest());
    reporter.onStepBegin(fakeTest(), fakeResult(), fakeStep());
    reporter.onStepEnd(fakeTest(), fakeResult(), fakeStep());
    reporter.onTestEnd(fakeTest(), fakeResult({ status: 'passed', duration: 10 }));
    reporter.onEnd(fakeFullResult({ status: 'passed' }));
    capture.restore();
    expect(capture.lines.length).toBe(0);
  });

  test('ignores Playwright-internal steps (expect/fixture/hook/pw:api categories, and any step nested inside our own)', () => {
    process.env.GAP_RUN_ID = 'run-8';
    const reporter = new LiveEventsReporter();
    reporter.onTestBegin(fakeTest());
    const capture = captureStdout();
    reporter.onStepBegin(fakeTest(), fakeResult(), fakeStep({ category: 'expect' }));
    reporter.onStepBegin(fakeTest(), fakeResult(), fakeStep({ category: 'pw:api' }));
    reporter.onStepBegin(
      fakeTest(),
      fakeResult(),
      fakeStep({ category: 'test.step', parent: fakeStep() }),
    );
    capture.restore();
    expect(capture.lines.length).toBe(0);
  });
});
