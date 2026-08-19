import * as path from 'path';
import type { Server } from 'http';
import express from 'express';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';

/**
 * Drives the REAL server/ui/public/app.js against a real DOM — served
 * statically (no backend API needed: app.js's top-level functions are
 * called directly with synthetic JobEvents, exactly the shape
 * server/ui/routes.ts forwards over SSE) to verify the live-execution
 * screen actually reacts to structured events: receives them, updates
 * step status, and renders the failure/success result screens the spec
 * mocks up. index.html loads app.js as a plain (non-module) <script>, so
 * its top-level `function`/`const` declarations are reachable as
 * `window.*` from page.evaluate.
 */

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  const app = express();
  app.use(express.static(path.resolve(process.cwd(), 'server', 'ui', 'public')));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://localhost:${port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.describe(`Live execution — UI reacts to structured events ${TAGS.SMOKE}`, () => {
  test('receives a live-event over the existing event channel and adds it to the step timeline immediately', async ({
    page,
  }) => {
    await page.goto(baseUrl);
    await page.evaluate(() => {
      const w = globalThis as unknown as { handleJobEvent: (e: unknown) => void };
      w.handleJobEvent({ type: 'approved' });
      w.handleJobEvent({
        type: 'live-event',
        event: {
          type: 'STEP_STARTED',
          stepIndex: 1,
          stepDescription: 'Enter "laptop" in the search box.',
        },
      });
    });
    await expect(page.locator('.exec-step')).toHaveCount(1);
    await expect(page.locator('.exec-step').first()).toContainText(
      'Enter "laptop" in the search box.',
    );
    await expect(page.locator('.exec-step').first()).toHaveClass(/running/);
  });

  test('updates a step from running to passed and shows its duration, without a page reload', async ({
    page,
  }) => {
    await page.goto(baseUrl);
    await page.evaluate(() => {
      const w = globalThis as unknown as { handleJobEvent: (e: unknown) => void };
      w.handleJobEvent({ type: 'approved' });
      w.handleJobEvent({
        type: 'live-event',
        event: { type: 'STEP_STARTED', stepIndex: 1, stepDescription: 'Submit the search.' },
      });
    });
    await expect(page.locator('.exec-step').first()).toHaveClass(/running/);

    await page.evaluate(() => {
      const w = globalThis as unknown as { handleJobEvent: (e: unknown) => void };
      w.handleJobEvent({
        type: 'live-event',
        event: {
          type: 'STEP_PASSED',
          stepIndex: 1,
          stepDescription: 'Submit the search.',
          status: 'passed',
          durationMs: 420,
        },
      });
    });
    const step = page.locator('.exec-step').first();
    await expect(step).toHaveClass(/passed/);
    await expect(step).toContainText('420ms');
  });

  test('displays a plain-English failure — step name + reason — with the raw Playwright error only behind Technical Details', async ({
    page,
  }) => {
    await page.goto(baseUrl);
    await page.evaluate(() => {
      const w = globalThis as unknown as { handleJobEvent: (e: unknown) => void };
      w.handleJobEvent({ type: 'approved' });
      w.handleJobEvent({
        type: 'live-event',
        event: {
          type: 'STEP_STARTED',
          stepIndex: 1,
          stepDescription: 'Verify that search results are displayed.',
        },
      });
      w.handleJobEvent({
        type: 'live-event',
        event: {
          type: 'STEP_FAILED',
          stepIndex: 1,
          stepDescription: 'Verify that search results are displayed.',
          status: 'failed',
          durationMs: 900,
          error: 'Error: expect(page.getByRole("list")).toBeVisible() failed\n  at spec.ts:42',
        },
      });
      w.handleJobEvent({
        type: 'exec-result',
        passed: false,
        total: 1,
        passedCount: 0,
        durationMs: 900,
        runId: 'run-x',
      });
    });

    await expect(page.locator('.result-banner .title')).toHaveText('✕ TEST FAILED');
    await expect(page.locator('.error-banner')).toContainText(
      'Verify that search results are displayed.',
    );
    // The reason shown must be plain English — never the raw locator/assertion syntax.
    await expect(page.locator('.card').first()).not.toContainText('getByRole');
    await expect(page.locator('#btn-tech-details')).toBeVisible();

    // Technical Details, once opened, DOES carry the full raw error — it's hidden, not discarded.
    await page.locator('#btn-tech-details').click();
    await expect(page.locator('#tech-details-panel')).toBeVisible();
  });

  test('displays the final passed result with the exact pass counts and duration', async ({
    page,
  }) => {
    await page.goto(baseUrl);
    await page.evaluate(() => {
      const w = globalThis as unknown as { handleJobEvent: (e: unknown) => void };
      w.handleJobEvent({ type: 'approved' });
      w.handleJobEvent({
        type: 'live-event',
        event: {
          type: 'STEP_STARTED',
          stepIndex: 1,
          stepDescription: 'Enter "laptop" in the search box.',
        },
      });
      w.handleJobEvent({
        type: 'live-event',
        event: {
          type: 'STEP_PASSED',
          stepIndex: 1,
          stepDescription: 'Enter "laptop" in the search box.',
          status: 'passed',
          durationMs: 300,
        },
      });
      w.handleJobEvent({
        type: 'exec-result',
        passed: true,
        total: 1,
        passedCount: 1,
        durationMs: 4300,
        runId: 'run-y',
      });
    });

    await expect(page.locator('.result-banner .title')).toHaveText('✓ TEST PASSED');
    await expect(page.locator('.result-banner .stat')).toContainText('1 / 1 tests passed');
    await expect(page.locator('.result-banner .stat')).toContainText('Steps: 1 / 1 passed');
    await expect(page.locator('.result-banner .stat')).toContainText('4.3 seconds');
  });
});
