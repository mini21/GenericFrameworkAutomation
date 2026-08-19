import { randomUUID } from 'crypto';
import { ChildProcess } from 'child_process';
import {
  GenerationOutcome,
  GenerationPhase,
} from '../../src/core/generation/generation-orchestrator';
import { LiveEvent } from '../../src/core/execution/live-events';

/**
 * One candidate on an ambiguity question card — carries real structural
 * context (which page it lives on, its relationship to the preceding
 * step's own resolved element) so a Manual QA sees WHY several candidates
 * share a label, rather than N visually identical choices. Mirrors
 * MappingCandidate's own optional fields (src/core/generation/
 * generation-types.ts) verbatim — this is that same data, just renamed
 * `description` for the existing "why it matched" prose the UI already
 * shows.
 */
export interface QuestionCandidate {
  label: string;
  description: string;
  value: string;
  pageName?: string;
  pageUrl?: string;
  relationship?: string;
  matchConfidence?: 'High' | 'Medium' | 'Low';
}

export type JobEvent =
  | { type: 'phase'; phase: GenerationPhase; detail?: string }
  | {
      type: 'question';
      questionId: string;
      kind: 'missing-value' | 'ambiguity';
      prompt: string;
      candidates?: QuestionCandidate[];
    }
  | {
      type: 'ready-for-approval';
      outcome: Extract<GenerationOutcome, { status: 'ready-for-approval' }>;
    }
  | { type: 'blocked'; message: string }
  | { type: 'rejected' }
  | { type: 'approved' }
  // One structured LiveEvent per Playwright test.step/test/run boundary —
  // see src/core/execution/live-events.ts. Replaces the earlier approach
  // of parsing Playwright's own console output; the frontend never
  // receives raw log text for execution progress.
  | { type: 'live-event'; event: LiveEvent }
  | {
      type: 'exec-result';
      passed: boolean;
      total: number;
      passedCount: number;
      durationMs: number;
      runId: string;
    }
  | { type: 'error'; message: string };

interface PendingQuestion {
  id: string;
  resolve: (answer: string | undefined) => void;
}

/**
 * One in-memory record per "Generate & Test" click — the web equivalent
 * of one interactive CLI session. Not persisted: a server restart loses
 * in-flight jobs, same as a CLI process exiting mid-prompt would.
 */
export class Job {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();
  application?: string;
  outcome?: Extract<GenerationOutcome, { status: 'ready-for-approval' }>;
  /** Set while a live execution is running — the runId passed as
   *  GAP_RUN_ID to the spawned Playwright process (see live-events.ts). */
  runId?: string;
  /** Raw combined stdout+stderr from the execution child — never streamed
   *  to the browser as it arrives (see live-event above); only exposed
   *  on demand via GET /api/jobs/:id/output for the "Technical Details"
   *  panel. */
  executionOutput?: string;
  /** True once cancel() has been called — the authoritative signal a run
   *  was user-cancelled, independent of whether the reporter's own
   *  RUN_CANCELLED event made it out before the process was force-killed. */
  cancelRequested = false;
  /** The spawned `npx playwright test` child — kept only so the cancel
   *  endpoint (routes.ts) can signal it. Cleared once the process exits. */
  private child?: ChildProcess;
  private readonly history: JobEvent[] = [];
  private readonly listeners = new Set<(event: JobEvent) => void>();
  private pendingQuestion?: PendingQuestion;

  emit(event: JobEvent): void {
    this.history.push(event);
    for (const listener of this.listeners) listener(event);
  }

  /** New SSE subscribers replay everything already emitted, so a page refresh mid-job still sees the full timeline. */
  subscribe(listener: (event: JobEvent) => void): () => void {
    for (const event of this.history) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pauses the caller until the browser answers via POST /api/jobs/:id/answer — the web equivalent of the CLI's readline prompt. */
  askQuestion(
    kind: 'missing-value' | 'ambiguity',
    prompt: string,
    candidates?: QuestionCandidate[],
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const questionId = randomUUID();
      this.pendingQuestion = { id: questionId, resolve };
      this.emit({ type: 'question', questionId, kind, prompt, candidates });
    });
  }

  answerQuestion(questionId: string, value: string | undefined): boolean {
    if (this.pendingQuestion?.id !== questionId) return false;
    const { resolve } = this.pendingQuestion;
    this.pendingQuestion = undefined;
    resolve(value);
    return true;
  }

  attachChild(child: ChildProcess): void {
    this.child = child;
    // Reset from any PREVIOUS run's cancellation — "Run Again" after a
    // cancelled run spawns a brand new child that has not been cancelled,
    // even though this Job object is being reused.
    this.cancelRequested = false;
    child.once('exit', () => {
      if (this.child === child) this.child = undefined;
    });
  }

  /**
   * SIGTERM — the same signal a human hitting Ctrl+C on `npx playwright
   * test` sends — not SIGKILL, so Playwright's own shutdown path (closing
   * the browser it launched, releasing the port the app-under-test server
   * holds) still runs instead of leaving an orphaned browser process.
   * Returns false when there is nothing running to cancel (already
   * finished, or never started).
   */
  cancel(): boolean {
    if (!this.child) return false;
    this.cancelRequested = true;
    const child = this.child;
    child.kill('SIGTERM');
    // Escalate if Playwright's own interrupt handling (closing the
    // browser it launched, releasing the app-under-test port) doesn't
    // finish promptly — SIGKILL is the last resort, not the first, so
    // this only fires when SIGTERM alone failed to end it.
    setTimeout(() => {
      if (this.child === child) child.kill('SIGKILL');
    }, 5000).unref();
    return true;
  }
}

const jobs = new Map<string, Job>();

export function createJob(): Job {
  const job = new Job();
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
