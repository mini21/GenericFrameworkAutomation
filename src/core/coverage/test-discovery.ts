import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiscoveredTest } from './coverage-types';

interface PlaywrightJsonSuite {
  suites?: PlaywrightJsonSuite[];
  specs?: { title: string; tags?: string[] }[];
  file?: string;
}

interface PlaywrightJsonReport {
  suites: PlaywrightJsonSuite[];
}

function flattenSpecs(suite: PlaywrightJsonSuite): DiscoveredTest[] {
  const tests: DiscoveredTest[] = [];
  for (const child of suite.suites ?? []) tests.push(...flattenSpecs(child));
  for (const spec of suite.specs ?? []) {
    tests.push({ title: spec.title, tags: spec.tags ?? [], file: suite.file });
  }
  return tests;
}

/**
 * Discovers every test Playwright knows about (no execution — `--list`
 * mode only) via the native JSON reporter, independent of any spec file.
 * This is the mechanism the coverage calculator cross-references
 * requirements.json against.
 */
export function discoverTests(): DiscoveredTest[] {
  const outFile = path.join(os.tmpdir(), `gap-coverage-list-${Date.now()}-${process.pid}.json`);
  try {
    execSync('npx playwright test --list --reporter=json', {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile },
      stdio: 'pipe',
    });
    const raw = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as PlaywrightJsonReport;
    return raw.suites.flatMap(flattenSpecs);
  } finally {
    fs.rmSync(outFile, { force: true });
  }
}
