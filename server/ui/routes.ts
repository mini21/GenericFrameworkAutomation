import { Router } from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import {
  runGenerationPipeline,
  approveGeneration,
  rejectGeneration,
  GenerationOutcome,
} from '../../src/core/generation/generation-orchestrator';
import { runCoverageReport } from '../../src/core/generation/generated-test-validator';
import {
  resolveExecution,
  toPlaywrightArgs,
  toEnv,
  countMatchingTests,
} from '../../src/core/execution/execution-resolver';
import {
  listApplications,
  applicationIdFromUrl,
  BrowserName,
} from '../../src/core/config/application-registry';
import { parseLiveEventLine, liveScreenshotPath } from '../../src/core/execution/live-events';
import { listGeneratedTests } from '../../src/core/generation/requirements-writer';
import { createJob, getJob, Job } from './jobs';
import * as history from './history-store';

export const router = Router();

// ---------------------------------------------------------------------------
// Generate — kicks off the SAME runGenerationPipeline the CLI's
// gap-generate/gap.ts already call, just supplying web-shaped callbacks
// (SSE progress, deferred-promise questions) instead of readline prompts.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'be',
  'able',
  'user',
  'users',
  'should',
  'can',
  'for',
  'in',
  'on',
  'of',
  'and',
  'that',
]);

/**
 * The web form has no "module" field — a non-technical user has no reason
 * to know what that means — so one is derived generically from the
 * requirement's own wording (first meaningful word, same "no fixed
 * vocabulary" spirit as requirement-parser.ts). Falls back to "general"
 * for a requirement with nothing left after stripping filler words. Only
 * used when the application has no registered module a navigate step
 * could already imply (see test-spec-builder.ts's own detectModule) —
 * this never overrides that.
 */
function deriveModule(requirementText: string): string {
  const words = requirementText
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  return words[0] || 'general';
}

function buildRequirementText(requirement: string, steps: string): string {
  const stepLines = steps
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [requirement.trim(), ...stepLines].filter(Boolean).join('\n');
}

interface GenerateRequestBody {
  url: string;
  requirement: string;
  steps: string;
  environment: string;
  browser: string;
}

router.post('/api/generate', (req, res) => {
  const body = req.body as Partial<GenerateRequestBody>;
  if (!body.url || !body.requirement) {
    res.status(400).json({ error: 'Application URL and Requirement are both required.' });
    return;
  }

  const job = createJob();
  res.json({ jobId: job.id });

  runGenerationJob(job, {
    url: body.url,
    requirement: body.requirement,
    steps: body.steps ?? '',
    environment: body.environment || 'qa',
    browser: (body.browser || 'chromium') as BrowserName,
  }).catch((error) => {
    job.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});

async function runGenerationJob(job: Job, input: GenerateRequestBody): Promise<void> {
  const application = applicationIdFromUrl(input.url);
  job.application = application;
  const requirementText = buildRequirementText(input.requirement, input.steps ?? '');

  const outcome: GenerationOutcome = await runGenerationPipeline({
    application,
    environment: input.environment,
    url: input.url,
    requirementText,
    module: undefined,
    diagnose: true,
    onPhase: (phase, detail) => job.emit({ type: 'phase', phase, detail }),
    resolveMissingValue: async (field, raw) => {
      const answer = await job.askQuestion('missing-value', `I need a value for "${field}".`, [
        { label: raw, description: raw, value: raw },
      ]);
      return answer;
    },
    resolveAmbiguity: async (step, candidates) => {
      const answer = await job.askQuestion(
        'ambiguity',
        `I found ${candidates.length} possible matches for "${step.raw}".`,
        candidates.map((c) => ({
          label: c.label,
          description: c.reasons.join('; '),
          value: c.value,
          pageName: c.pageName,
          pageUrl: c.pageUrl,
          relationship: c.relationship,
          matchConfidence: c.matchConfidence,
          elementType: c.elementType,
        })),
      );
      return answer;
    },
  });

  // buildTestSpecification's own module-detection only looks at navigate
  // steps against modules the application ALREADY has registered — a
  // brand-new application (the common case here) has none yet, so supply
  // the generic fallback derived above and retry once, exactly like a CLI
  // caller re-running with --module would. Keeps runGenerationPipeline's
  // own contract (module stays optional, still inferred first) untouched.
  if (outcome.status === 'blocked' && /determine which module/.test(outcome.message)) {
    const retried = await runGenerationPipeline({
      application,
      environment: input.environment,
      requirementText,
      module: deriveModule(input.requirement),
      diagnose: true,
      onPhase: (phase, detail) => job.emit({ type: 'phase', phase, detail }),
    });
    finishGeneration(job, retried);
    return;
  }

  finishGeneration(job, outcome);
}

function finishGeneration(job: Job, outcome: GenerationOutcome): void {
  if (outcome.status === 'blocked') {
    job.emit({ type: 'blocked', message: outcome.message });
    return;
  }
  job.outcome = outcome;
  job.emit({ type: 'ready-for-approval', outcome });
}

router.post('/api/jobs/:id/answer', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Unknown job.' });
    return;
  }
  const { questionId, value } = req.body as { questionId?: string; value?: string };
  if (!questionId) {
    res.status(400).json({ error: 'questionId is required.' });
    return;
  }
  const ok = job.answerQuestion(questionId, value || undefined);
  res.json({ ok });
});

router.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const unsubscribe = job.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  req.on('close', unsubscribe);
});

/** The real generated TypeScript source, for the review screen's optional "View generated code" panel — technical users only, never required reading. */
router.get('/api/jobs/:id/code', (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.outcome) {
    res.status(404).json({ error: 'No generated test on this job.' });
    return;
  }
  const code = fs.existsSync(job.outcome.filePath)
    ? fs.readFileSync(job.outcome.filePath, 'utf-8')
    : '';
  res.json({ filePath: job.outcome.filePath, code });
});

// ---------------------------------------------------------------------------
// Approve / Reject — the SAME approveGeneration/rejectGeneration the CLI
// already calls after a human says yes/no.
// ---------------------------------------------------------------------------

router.post('/api/jobs/:id/reject', (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.outcome) {
    res.status(404).json({ error: 'No pending generated test on this job.' });
    return;
  }
  rejectGeneration(job.outcome);
  job.emit({ type: 'rejected' });
  res.json({ ok: true });
});

router.post('/api/jobs/:id/approve', (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.outcome || !job.application) {
    res.status(404).json({ error: 'No pending generated test on this job.' });
    return;
  }
  approveGeneration(job.outcome);
  job.emit({ type: 'approved' });
  res.json({ ok: true });

  const environment = (req.body as { environment?: string })?.environment || 'qa';
  const browser = ((req.body as { browser?: string })?.browser || 'chromium') as BrowserName;
  runExecutionJob(
    job,
    job.application,
    environment,
    browser,
    job.outcome.stableTestId,
    job.outcome.spec.requirementText,
  ).catch((error) => {
    job.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});

/** "Run Again" on the result screen — re-executes the SAME already-approved test (no re-approval, no re-generation), via the same runExecutionJob the initial approve uses. */
router.post('/api/jobs/:id/rerun', (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.outcome || !job.application) {
    res.status(404).json({ error: 'No approved test on this job to re-run.' });
    return;
  }
  res.json({ ok: true });

  const environment = (req.body as { environment?: string })?.environment || 'qa';
  const browser = ((req.body as { browser?: string })?.browser || 'chromium') as BrowserName;
  runExecutionJob(
    job,
    job.application,
    environment,
    browser,
    job.outcome.stableTestId,
    job.outcome.spec.requirementText,
  ).catch((error) => {
    job.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});

// ---------------------------------------------------------------------------
// Run an EXISTING generated test — same execution path as approve/rerun
// above, just without a fresh generation/approval step first. Lets a
// Manual QA re-run a test GAP already generated (and prove live execution
// works for an application without regenerating anything) straight from
// the Applications tab.
// ---------------------------------------------------------------------------

router.get('/api/applications/:id/tests', (req, res) => {
  res.json(listGeneratedTests(req.params.id));
});

router.post('/api/tests/run', (req, res) => {
  const body = req.body as {
    application?: string;
    stableTestId?: string;
    requirementText?: string;
    environment?: string;
    browser?: string;
  };
  if (!body.application || !body.stableTestId) {
    res.status(400).json({ error: 'application and stableTestId are both required.' });
    return;
  }

  const job = createJob();
  job.application = body.application;
  res.json({ jobId: job.id });

  const environment = body.environment || 'qa';
  const browser = (body.browser || 'chromium') as BrowserName;
  runExecutionJob(
    job,
    body.application,
    environment,
    browser,
    body.stableTestId,
    body.requirementText || '',
  ).catch((error) => {
    job.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});

// ---------------------------------------------------------------------------
// Execute — the SAME resolveExecution/toPlaywrightArgs/toEnv the CLI's
// gap-test.ts already uses, run through the exact same `npx playwright
// test` the CLI shells out to. Live progress comes from a proper
// structured event model (src/core/execution/live-events.ts), emitted by
// a Playwright Reporter running INSIDE that child process and read back
// over stdout as one `GAP_LIVE_EVENT <json>`-prefixed line per event —
// see live-events-reporter.ts. Nothing here parses Playwright's own
// human-readable console output; any stdout/stderr line that isn't that
// exact structured protocol is captured only for the optional Technical
// Details panel, never forwarded to the browser as it arrives.
// ---------------------------------------------------------------------------

async function runExecutionJob(
  job: Job,
  application: string,
  environment: string,
  browser: BrowserName,
  stableTestId: string,
  requirementText: string,
): Promise<void> {
  const resolved = resolveExecution({
    cli: {
      application,
      environment,
      browsers: [browser],
      tags: [`@${stableTestId}`],
      type: 'functional',
    },
  });
  const args = toPlaywrightArgs(resolved);
  const runId = randomUUID();
  job.runId = runId;
  const env = {
    ...process.env,
    ...toEnv(resolved),
    GAP_RUN_ID: runId,
    GAP_APPLICATION: application,
    GAP_REQUIREMENT: requirementText,
  };
  const startedAt = Date.now();

  // Recorded as 'running' immediately — see history-store.ts's startRun —
  // so Test History shows this run in progress, not only once it ends.
  history.startRun({ runId, application, requirementText, stableTestId });

  const child = spawn('npx', ['playwright', ...args], { env });
  job.attachChild(child);

  let buffer = '';
  let rawOutput = '';
  let lastRunStatus: 'passed' | 'failed' | undefined;
  let sawRunCancelled = false;
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    rawOutput += text;
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const event = parseLiveEventLine(raw.trim());
      if (!event) continue;
      job.emit({ type: 'live-event', event });
      if (event.type === 'RUN_COMPLETED') lastRunStatus = event.status;
      if (event.type === 'RUN_CANCELLED') sawRunCancelled = true;
    }
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);

  const exitCode: number = await new Promise((resolve) =>
    child.on('close', (code) => resolve(code ?? 1)),
  );
  const durationMs = Date.now() - startedAt;
  job.executionOutput = rawOutput;

  if (job.cancelRequested) {
    // Covers both paths: the reporter caught the SIGTERM and emitted
    // RUN_CANCELLED itself (sawRunCancelled), or the process had to be
    // force-killed before it got the chance — either way the UI still
    // needs exactly one cancellation event.
    if (!sawRunCancelled) {
      job.emit({
        type: 'live-event',
        event: {
          type: 'RUN_CANCELLED',
          runId,
          application,
          requirement: requirementText,
          timestamp: new Date().toISOString(),
        },
      });
    }
    history.updateRun(runId, { status: 'cancelled', durationMs });
    return;
  }

  const discovery =
    exitCode !== 0 && lastRunStatus !== 'passed' ? countMatchingTests(resolved) : undefined;
  if (discovery && discovery.matchCount === 0) {
    job.emit({
      type: 'error',
      message: 'No generated automation exists for this requirement — nothing to execute.',
    });
    history.updateRun(runId, { status: 'failed', durationMs });
    return;
  }

  const passed = lastRunStatus ? lastRunStatus === 'passed' : exitCode === 0;
  job.emit({
    type: 'exec-result',
    passed,
    total: 1,
    passedCount: passed ? 1 : 0,
    durationMs,
    runId,
  });

  history.updateRun(runId, {
    status: passed ? 'passed' : 'failed',
    passedCount: passed ? 1 : 0,
    total: 1,
    durationMs,
  });
}

// ---------------------------------------------------------------------------
// Dashboards — applications (from the existing registry, no hardcoded
// list), test history (this UI's own run log), coverage (the existing
// coverage project, unchanged).
// ---------------------------------------------------------------------------

router.get('/api/applications', (_req, res) => {
  const apps = listApplications();
  res.json(
    Object.entries(apps).map(([id, def]) => ({
      id,
      name: def.name,
      baseUrl: def.baseUrl,
      ...history.summaryFor(id),
    })),
  );
});

router.get('/api/history', (_req, res) => {
  res.json(history.listAll());
});

router.get('/api/coverage/:application', (req, res) => {
  const result = runCoverageReport(req.params.application);
  res.json({ passed: result.passed, output: result.output });
});

router.get('/api/report-status', (_req, res) => {
  const reportIndex = 'reports/html-report/index.html';
  res.json({ available: fs.existsSync(reportIndex) });
});

// ---------------------------------------------------------------------------
// Live execution support — cancel, raw output (Technical Details panel),
// and per-step screenshots. Nothing here executes Playwright itself; it
// only signals/reads the child process runExecutionJob already spawned.
// ---------------------------------------------------------------------------

router.post('/api/jobs/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Unknown job.' });
    return;
  }
  const cancelled = job.cancel();
  if (!cancelled) {
    res.status(409).json({ error: 'No running execution to cancel.' });
    return;
  }
  res.json({ ok: true });
});

/** Raw combined stdout+stderr from the execution child — the "Technical Details" panel's content, never streamed live. */
router.get('/api/jobs/:id/output', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Unknown job.' });
    return;
  }
  res.json({ output: job.executionOutput ?? '' });
});

/** One JPEG per step, captured at meaningful boundaries only — see live-step.ts's captureLiveScreenshot. */
router.get('/api/jobs/:id/screenshots/:step', (req, res) => {
  const job = getJob(req.params.id);
  const stepIndex = Number(req.params.step);
  if (!job?.runId || !Number.isInteger(stepIndex) || stepIndex < 1) {
    res.status(404).end();
    return;
  }
  const filePath = liveScreenshotPath(job.runId, stepIndex);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});
