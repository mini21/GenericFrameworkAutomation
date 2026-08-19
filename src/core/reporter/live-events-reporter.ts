import type {
  Reporter,
  FullResult,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import {
  LiveEvent,
  LiveEventType,
  formatLiveEvent,
  isAssertionDescription,
  liveScreenshotPath,
} from '../execution/live-events';

/**
 * Registered unconditionally alongside the other reporters in
 * playwright.config.ts — same execution path for every run, CLI or web
 * UI — but a complete no-op unless GAP_RUN_ID is set (only the web UI's
 * post-approval execution spawn sets it). A normal `gap:test`/CI run pays
 * one env var check per event and nothing else: no extra stdout, no
 * extra I/O. This is the ONLY thing translating Playwright's own
 * onStepBegin/onStepEnd (test.step boundaries the generated test itself
 * declares — see live-step.ts) into the structured LiveEvent model
 * server/ui/routes.ts consumes — never a second execution engine.
 */
export default class LiveEventsReporter implements Reporter {
  private readonly runId = process.env.GAP_RUN_ID;
  private readonly stepIndexByTest = new Map<string, number>();

  private emit(
    partial: Omit<LiveEvent, 'runId' | 'timestamp' | 'application' | 'requirement'>,
  ): void {
    if (!this.runId) return;
    const event: LiveEvent = {
      ...partial,
      runId: this.runId,
      application: process.env.GAP_APPLICATION || undefined,
      requirement: process.env.GAP_REQUIREMENT || undefined,
      timestamp: new Date().toISOString(),
    };
    process.stdout.write(`${formatLiveEvent(event)}\n`);
  }

  onBegin(): void {
    this.emit({ type: 'RUN_STARTED' });
  }

  onTestBegin(test: TestCase): void {
    this.stepIndexByTest.set(test.id, 0);
    this.emit({ type: 'TEST_STARTED', testId: test.id });
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
    // Only OUR explicit test.step() boundaries (see live-step.ts) — never
    // Playwright's own internal `expect`/`fixture`/`hook`/`pw:api` steps,
    // and never a step nested inside one of ours (a verify step's own
    // internal expect() call is itself an `expect`-category child step,
    // already excluded by the category check).
    if (step.category !== 'test.step' || step.parent) return;
    const index = (this.stepIndexByTest.get(test.id) ?? 0) + 1;
    this.stepIndexByTest.set(test.id, index);
    this.emit({
      type: isAssertionDescription(step.title) ? 'ASSERTION_STARTED' : 'STEP_STARTED',
      testId: test.id,
      stepIndex: index,
      stepDescription: step.title,
    });
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.category !== 'test.step' || step.parent) return;
    const index = this.stepIndexByTest.get(test.id) ?? 0;
    const passed = !step.error;
    const isAssertion = isAssertionDescription(step.title);
    const type: LiveEventType = passed
      ? isAssertion
        ? 'ASSERTION_PASSED'
        : 'STEP_PASSED'
      : isAssertion
        ? 'ASSERTION_FAILED'
        : 'STEP_FAILED';
    const screenshotPath = this.runId ? liveScreenshotPath(this.runId, index) : undefined;
    this.emit({
      type,
      testId: test.id,
      stepIndex: index,
      stepDescription: step.title,
      status: passed ? 'passed' : 'failed',
      durationMs: Math.round(step.duration),
      error: step.error?.message,
      screenshotPath: screenshotPath && fs.existsSync(screenshotPath) ? screenshotPath : undefined,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // 'interrupted' is Playwright's own status for a SIGTERM/SIGINT-driven
    // stop (see FullResult/TestResult in testReporter.d.ts) — exactly what
    // Job#cancel() sends (routes.ts's cancel endpoint), so this is the
    // real signal a cancelled run produces, not something inferred from
    // exit code.
    this.emit({
      type: result.status === 'interrupted' ? 'TEST_CANCELLED' : 'TEST_COMPLETED',
      testId: test.id,
      status: result.status === 'passed' ? 'passed' : 'failed',
      durationMs: Math.round(result.duration),
      error: result.error?.message,
    });
  }

  onEnd(result: FullResult): void {
    this.emit({
      type: result.status === 'interrupted' ? 'RUN_CANCELLED' : 'RUN_COMPLETED',
      status: result.status === 'passed' ? 'passed' : 'failed',
    });
  }
}
