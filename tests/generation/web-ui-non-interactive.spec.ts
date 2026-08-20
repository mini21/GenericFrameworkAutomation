import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { createJob } from '../../server/ui/jobs';
import { runGenerationJob } from '../../server/ui/routes';
import { rejectGeneration } from '../../src/core/generation/generation-orchestrator';
import {
  registerApplication,
  unregisterApplication,
} from '../../src/core/config/application-registry';
import { TAGS } from '../../src/core/constants';

/**
 * The actual reported bug: the web UI's normal "Generate & Test" path was
 * still wired to job.askQuestion() for BOTH missing-value clarification
 * and locator ambiguity, so a job could end up waiting forever on a
 * /api/jobs/:id/answer that no one (no human is watching a headless
 * pipeline run) would ever send — "stuck at Waiting for approval". This
 * exercises the REAL server/ui/routes.ts entry point end to end (not just
 * the underlying orchestrator) against a genuinely tied-candidate page —
 * exactly the shape that used to trigger the hang.
 */

const TWO_TIED_BUTTONS_HTML = `
<!DOCTYPE html>
<html>
<head><title>Tied buttons fixture</title></head>
<body>
  <h1>Tied buttons fixture</h1>
  <button id="a">Search</button>
  <button id="b">Search</button>
</body>
</html>
`;

function listenEphemeral(html: string): { server: http.Server; baseUrl: string } {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  server.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, baseUrl: `http://localhost:${port}` };
}

// Serial, not parallel: each test registers/unregisters an application,
// a read-modify-write against the SHARED config/applications.json file —
// concurrent workers racing on that file (this project's own
// fullyParallel: true default) can corrupt a write in flight. Matches the
// same serial-mode convention contextual-candidate-ranking.spec.ts's own
// registration-heavy describe block already uses.
test.describe.configure({ mode: 'serial' });

test.describe(`Web UI generation — non-interactive by construction ${TAGS.SMOKE}`, () => {
  test('a genuinely tied/ambiguous candidate never calls job.askQuestion() through the real /api/generate path — ends blocked, never waiting', async () => {
    const { server, baseUrl } = listenEphemeral(TWO_TIED_BUTTONS_HTML);
    const appId = `gap-test-webui-tied-${Date.now()}`;
    registerApplication(appId, {
      name: 'Tied Buttons WebUI Test',
      baseUrl,
      modules: ['general'],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });

    const job = createJob();
    let askQuestionCalls = 0;
    const originalAskQuestion = job.askQuestion.bind(job);
    job.askQuestion = (...args) => {
      askQuestionCalls += 1;
      return originalAskQuestion(...args);
    };

    const events: string[] = [];
    job.subscribe((event) => events.push(event.type));

    try {
      await runGenerationJob(job, {
        url: baseUrl,
        requirement: 'User should be able to search.',
        // Two identically-named "Search" buttons, zero distinguishing
        // context — a genuine tie (the exact shape that used to produce
        // an `ambiguous` mapping and wait on askQuestion()).
        steps: 'Click Search.',
        environment: 'qa',
        browser: 'chromium',
      });

      expect(askQuestionCalls).toBe(0);
      expect(events).not.toContain('question');
      expect(events).toContain('blocked');
      expect(events).not.toContain('ready-for-approval');
    } finally {
      unregisterApplication(appId);
      const appDir = path.resolve(process.cwd(), 'applications', appId);
      if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('a missing-value ("Enter <field>") step with no test-data profile entry never calls job.askQuestion() through the real /api/generate path', async () => {
    const html = `
      <!DOCTYPE html>
      <html><head><title>Form fixture</title></head>
      <body>
        <h1>Form fixture</h1>
        <form>
          <label for="notes">Notes</label>
          <input id="notes" name="notes" type="text" />
          <button type="submit">Submit</button>
        </form>
      </body></html>
    `;
    const { server, baseUrl } = listenEphemeral(html);
    const appId = `gap-test-webui-missingvalue-${Date.now()}`;
    registerApplication(appId, {
      name: 'Missing Value WebUI Test',
      baseUrl,
      modules: ['general'],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });

    const job = createJob();
    let askQuestionCalls = 0;
    const originalAskQuestion = job.askQuestion.bind(job);
    job.askQuestion = (...args) => {
      askQuestionCalls += 1;
      return originalAskQuestion(...args);
    };

    try {
      await runGenerationJob(job, {
        url: baseUrl,
        requirement: 'User should be able to submit notes.',
        steps: 'Enter notes.\nSubmit the request.', // no explicit value stated, no data profile for this app
        environment: 'qa',
        browser: 'chromium',
      });

      expect(askQuestionCalls).toBe(0);
    } finally {
      unregisterApplication(appId);
      const appDir = path.resolve(process.cwd(), 'applications', appId);
      if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('ACCEPTANCE: the full search -> select -> details -> cart -> verify workflow completes through the REAL /api/generate path with zero askQuestion calls', async () => {
    // The exact acceptance shape from the product requirement, run through
    // the real web UI generation entry point (server/ui/routes.ts), not
    // just internal function calls — against the deterministic Storefront
    // reference app (Amazon itself is explicitly a best-effort stress
    // test elsewhere, never the acceptance gate: consent dialogs, A/B
    // content, bot defenses). Uses the REAL, already-registered
    // "storefront" application on its playwright.config.ts-managed
    // stable port (4300) rather than a freshly-registered/ephemeral one:
    // applicationIdFromUrl resolves by origin match against the registry
    // first, so a NEW registration at the same origin is silently
    // shadowed anyway — and the generation pipeline's own validation
    // phase spawns a SEPARATE child process to actually execute the
    // generated test, which cannot reliably reach an ephemeral random-port
    // server created inside THIS test process in this sandbox (an
    // environmental fragility of ad-hoc servers, unrelated to the
    // resolution architecture this test is actually proving).
    const job = createJob();
    let askQuestionCalls = 0;
    const originalAskQuestion = job.askQuestion.bind(job);
    job.askQuestion = (...args) => {
      askQuestionCalls += 1;
      return originalAskQuestion(...args);
    };

    let blockedMessage: string | undefined;
    job.subscribe((event) => {
      if (event.type === 'blocked') blockedMessage = event.message;
    });

    try {
      await runGenerationJob(job, {
        url: 'http://localhost:4300',
        requirement:
          'Verify that a user can search for a product, view the search results, select a ' +
          'product, open the product details page, add the selected product to the cart, open ' +
          'the cart, and verify that the selected product is present in the cart.',
        steps: [
          'Search for a product.',
          'Verify search results are displayed.',
          'Select a product.',
          'Open the product details page.',
          'Add the selected product to the cart.',
          'Open the cart.',
          'Verify the selected product is present in the cart.',
        ].join('\n'),
        environment: 'qa',
        browser: 'chromium',
      });

      // The core product requirement: zero interactive prompts, ever, in
      // the normal web generation path.
      expect(askQuestionCalls).toBe(0);

      const outcome = job.outcome;
      if (!outcome) {
        throw new Error(
          `Expected ready-for-approval, job never reached it. Job id: ${job.id}. Blocked message: ${blockedMessage}`,
        );
      }
      expect(outcome.status).toBe('ready-for-approval');
      // Requirement kept separate from Test Steps — the Requirement
      // sentence ("Verify that a user can search...") never became an
      // executable step. "Search for a product" decomposes into two
      // (fill + submit), so 7 Test Steps lines produce 8 resolved steps.
      expect(outcome.spec.steps).toHaveLength(8);
      // No application-specific data profile for "product.searchTerm" is
      // configured on the real storefront app, so this correctly falls
      // back to the discovered catalog (deterministic, never invented) —
      // see incremental-planning.spec.ts's tests 2/2b/2c for the
      // data-profile-priority path itself, already covered directly.
      expect(
        outcome.spec.steps.some(
          (s) => s.resolved?.description === "ui.fill('Search', 'Wireless Mouse')",
        ),
      ).toBe(true);
      expect(
        outcome.spec.steps.some((s) => s.step.raw === 'Add the selected product to the cart'),
      ).toBe(true);
      expect(outcome.spec.steps.every((s) => s.confidence === 'HIGH')).toBe(true);
      expect(
        outcome.spec.steps.every((s) => s.decision === undefined || s.decision === 'AUTO_SELECTED'),
      ).toBe(true);
      rejectGeneration(outcome); // never save a test this spec didn't explicitly approve
    } finally {
      // No app cleanup needed — this reuses the real, already-registered
      // "storefront" application; rejectGeneration above already undoes
      // the one file this run would otherwise have written.
    }
  });
});
