import { spawn } from 'child_process';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';
import { createJob } from '../../server/ui/jobs';

/**
 * Job#cancel() (server/ui/jobs.ts) is what the web UI's cancel endpoint
 * (POST /api/jobs/:id/cancel, see server/ui/routes.ts) calls to stop a
 * running `npx playwright test` child — the same SIGTERM contract a human
 * hitting Ctrl+C would use, with a SIGKILL escalation if the process
 * doesn't exit promptly. Exercised here against a real spawned child
 * process (not `npx playwright test` itself, to keep this fast and
 * deterministic) so the actual OS-level signal delivery and exit are
 * verified, not just that `.kill()` was called.
 */
test.describe(`Live execution — cancel cleans up the runner ${TAGS.SMOKE}`, () => {
  test('cancel() signals the child and it actually exits — no orphaned process left behind', async () => {
    const job = createJob();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    job.attachChild(child);

    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code));
    });

    expect(job.cancel()).toBe(true);

    const result = await Promise.race([
      exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);
    expect(result).not.toBe('timeout');
  });

  test('cancel() returns false once nothing is running — never re-signals an already-exited process', async () => {
    const job = createJob();
    const child = spawn(process.execPath, ['-e', '']);
    job.attachChild(child);
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    expect(job.cancel()).toBe(false);
  });

  test('a Job with no child attached yet cannot be cancelled', () => {
    const job = createJob();
    expect(job.cancel()).toBe(false);
  });
});
