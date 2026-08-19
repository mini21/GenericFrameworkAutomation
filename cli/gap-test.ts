import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import {
  resolveExecution,
  toPlaywrightArgs,
  toEnv,
  countMatchingTests,
  CliOverrides,
} from '../src/core/execution/execution-resolver';
import { loadManifest, TestType } from '../src/core/execution/execution-manifest';
import { BrowserName } from '../src/core/config/application-registry';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function main(): void {
  const { values } = parseArgs({
    options: {
      application: { type: 'string' },
      environment: { type: 'string' },
      module: { type: 'string' },
      type: { type: 'string' },
      browser: { type: 'string' },
      headless: { type: 'string' },
      workers: { type: 'string' },
      retries: { type: 'string' },
      tags: { type: 'string' },
      'data-profile': { type: 'string' },
      'auth-profile': { type: 'string' },
      manifest: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
    strict: true,
  });

  const manifest = values.manifest ? loadManifest(values.manifest) : {};

  const cli: Partial<CliOverrides> = {
    application: values.application,
    environment: values.environment,
    module: values.module,
    type: values.type as TestType | undefined,
    browsers: values.browser ? (splitList(values.browser) as BrowserName[]) : undefined,
    headless: values.headless !== undefined ? values.headless === 'true' : undefined,
    workers: values.workers !== undefined ? Number(values.workers) : undefined,
    retries: values.retries !== undefined ? Number(values.retries) : undefined,
    tags: values.tags ? splitList(values.tags) : undefined,
    dataProfile: values['data-profile'],
    authProfile: values['auth-profile'],
  };

  const resolved = resolveExecution({ cli, env: process.env, manifest });
  const playwrightArgs = toPlaywrightArgs(resolved);
  const env = { ...process.env, ...toEnv(resolved) };

  process.stdout.write('\nGAP: resolved execution plan\n');
  process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
  process.stdout.write(`\nGAP: npx playwright ${playwrightArgs.join(' ')}\n\n`);

  if (values['dry-run']) {
    process.stdout.write('GAP: --dry-run set, not executing.\n');
    return;
  }

  const result = spawnSync('npx', ['playwright', ...playwrightArgs], { stdio: 'inherit', env });

  if (result.status !== 0) {
    const discovery = countMatchingTests(resolved);
    if (discovery.matchCount === 0) {
      const tagList = resolved.tags.join(', ') || '(none)';
      process.stdout.write(
        `\nGAP: No generated automation exists for this requirement — nothing under ` +
          `applications/${resolved.application}/tests matches application="${resolved.application}"` +
          `${resolved.module ? `, module="${resolved.module}"` : ''}, tags=[${tagList}]. ` +
          'Generate and approve it first (npm run gap:generate), or double-check the ' +
          "--tags/--module you passed match an existing generated test's own tags.\n\n",
      );
    }
  }

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  process.stderr.write(`\nGAP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
