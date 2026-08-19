import * as fs from 'fs';
import * as path from 'path';
import { Page, test } from '@playwright/test';
import { liveScreenshotPath } from './live-events';

/**
 * Wraps one generated step's action in Playwright's OWN native
 * `test.step()` — the existing, standard mechanism a reporter observes
 * via onStepBegin/onStepEnd, not a parallel execution engine. Every
 * generated test (CLI or UI, live run or not) is structured this way
 * unconditionally: test.step is transparent to pass/fail (a thrown error
 * still fails the step and the test exactly as before), and the optional
 * screenshot capture below is a no-op unless GAP_RUN_ID is set — so a
 * normal CLI/validation run pays nothing beyond one env var check.
 */
export async function liveStep(
  description: string,
  stepIndex: number,
  page: Page,
  action: () => Promise<void>,
): Promise<void> {
  await test.step(description, async () => {
    try {
      await action();
    } finally {
      await captureLiveScreenshot(page, stepIndex);
    }
  });
}

/**
 * Only active during a live-execution run (server/ui/routes.ts sets
 * GAP_RUN_ID when it spawns one) — a plain `gap:test`/CLI run, or the
 * generation pipeline's own validation execution, never writes these
 * files. Failures to capture (page already closed/navigated away) are
 * swallowed: a missing screenshot is never worth failing a test over.
 */
export async function captureLiveScreenshot(page: Page, stepIndex: number): Promise<void> {
  const runId = process.env.GAP_RUN_ID;
  if (!runId) return;
  const filePath = liveScreenshotPath(runId, stepIndex);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 60, timeout: 3000 });
  } catch {
    // Best-effort — see above.
  }
}
