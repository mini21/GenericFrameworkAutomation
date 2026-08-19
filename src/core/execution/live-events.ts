import * as path from 'path';

/**
 * The generic, application-agnostic structured event model for live test
 * execution — shared by the producer (live-step.ts's runtime helper +
 * reporter/live-events-reporter.ts, both running INSIDE the spawned
 * Playwright process) and every consumer (currently server/ui/routes.ts,
 * forwarding to the browser over SSE). Nothing here knows about any
 * specific application, requirement, or step content — it only knows
 * about Run/Test/Step/Assertion, exactly as required. A UI (or anything
 * else) driving a multi-test suite through this model works unchanged;
 * today's single-generated-test case is just the current caller's choice,
 * not something baked into the event shape.
 */
export type LiveEventType =
  | 'RUN_STARTED'
  | 'DISCOVERY_STARTED'
  | 'DISCOVERY_COMPLETED'
  | 'GENERATION_STARTED'
  | 'GENERATION_COMPLETED'
  | 'TEST_STARTED'
  | 'STEP_STARTED'
  | 'STEP_PASSED'
  | 'STEP_FAILED'
  | 'ASSERTION_STARTED'
  | 'ASSERTION_PASSED'
  | 'ASSERTION_FAILED'
  | 'TEST_COMPLETED'
  | 'RUN_COMPLETED'
  | 'TEST_CANCELLED'
  | 'RUN_CANCELLED';

export interface LiveEvent {
  type: LiveEventType;
  runId: string;
  testId?: string;
  application?: string;
  requirement?: string;
  timestamp: string;
  /** 1-based position within the test, present on STEP_ and ASSERTION_ events. */
  stepIndex?: number;
  /** Human-readable, Manual-QA-facing description — the requirement's own wording, never a locator/selector. */
  stepDescription?: string;
  status?: 'passed' | 'failed';
  durationMs?: number;
  error?: string;
  screenshotPath?: string;
  /** Present only on *_COMPLETED — mirrors the existing execution result shape (executionPassRate etc.), never a second source of truth for it. */
  technicalDetails?: string;
}

/**
 * One JSON-per-line marker on stdout — a deliberate, documented protocol
 * (not "parse raw console output"): every line starting with this prefix
 * is exactly one LiveEvent, nothing else on that line. Picked over a
 * network callback (HTTP/WebSocket back to the UI server) because the
 * reporter runs inside a plain `npx playwright test` child process the UI
 * server already spawns and already reads stdout from — no new port, no
 * new auth, no coupling to which process happens to be listening.
 */
export const LIVE_EVENT_MARKER = 'GAP_LIVE_EVENT ';

export function formatLiveEvent(event: LiveEvent): string {
  return `${LIVE_EVENT_MARKER}${JSON.stringify(event)}`;
}

export function parseLiveEventLine(line: string): LiveEvent | undefined {
  if (!line.startsWith(LIVE_EVENT_MARKER)) return undefined;
  try {
    return JSON.parse(line.slice(LIVE_EVENT_MARKER.length)) as LiveEvent;
  } catch {
    return undefined;
  }
}

/**
 * Same requirement-parser.ts convention already used to recognize a bare
 * "Verify .../Check .../Confirm ..." sentence — reused here (not
 * reimplemented as a different rule) so a step reported as an assertion
 * to the live UI is exactly the same set of steps ui-mapper.ts already
 * treats as one.
 */
export function isAssertionDescription(description: string): boolean {
  return /^(?:verify|check|confirm)\b/i.test(description.trim());
}

/**
 * Where a live screenshot for one step of one run lives — the SAME
 * formula used by both the runtime capture helper (live-step.ts, writing
 * the file from inside the running test) and the reporter (reading it
 * back to attach to the event), so there is exactly one place this path
 * scheme is defined.
 */
export function liveScreenshotPath(runId: string, stepIndex: number): string {
  return path.resolve(process.cwd(), 'test-results', 'live', runId, `step-${stepIndex}.jpg`);
}
