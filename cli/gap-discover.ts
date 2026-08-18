import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { crawlApplication } from '../src/core/discovery/site-crawler';
import { writeApplicationMap, formatSummary } from '../src/core/discovery/application-map-writer';
import { ensureApplicationRegistered } from '../src/core/config/application-registry';

// Launches chromium directly (plain `playwright`, not the `BrowserManager`
// utility) deliberately: BrowserManager pulls in the Winston logger, which
// pulls in EnvironmentManager/config/env.config.ts — that module validates
// BASE_URL/API_BASE_URL against a *registered* environment's .env file at
// import time. Discovery targets an arbitrary --url a Manual QA is still
// onboarding, often before any environment/application registration
// exists, so it must stay fully decoupled from that system.
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      application: { type: 'string' },
      url: { type: 'string' },
      'start-path': { type: 'string' },
      'storage-state': { type: 'string' },
      'max-pages': { type: 'string' },
      headless: { type: 'string' },
    },
    strict: true,
  });

  if (!values.application || !values.url) {
    throw new Error(
      'Usage: npm run gap:discover -- --application=<id> --url=<baseUrl> ' +
        '[--start-path=/] [--storage-state=<path>] [--max-pages=15] [--headless=true]',
    );
  }

  const application = values.application;
  const baseUrl = values.url;
  const startPath = values['start-path'] ?? '/';
  const storageStatePath = values['storage-state'];
  const maxPages = values['max-pages'] ? Number(values['max-pages']) : 15;
  const headless = values.headless !== 'false';

  process.stdout.write(`\nGAP: discovering "${application}" at ${baseUrl}\n`);
  if (storageStatePath) {
    process.stdout.write(`GAP: using authenticated session from ${storageStatePath}\n`);
  }
  process.stdout.write(
    `GAP: crawling up to ${maxPages} same-origin page(s), starting at ${startPath}\n`,
  );

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ baseURL: baseUrl, storageState: storageStatePath });
    const map = await crawlApplication(context, { application, baseUrl, startPath, maxPages });
    const filePath = writeApplicationMap(map);
    ensureApplicationRegistered(application, baseUrl, undefined, startPath);

    process.stdout.write(`\n${formatSummary(map)}\n`);
    process.stdout.write(`GAP: application map written to ${filePath}\n\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`\nGAP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
