import { spawnSync } from 'node:child_process';
import { resolveExecution, toPlaywrightArgs, toEnv } from '../execution/execution-resolver';

export interface CheckResult {
  passed: boolean;
  output: string;
}

/**
 * Every `spawnSync` in this file previously had no `timeout` — a genuinely
 * stuck child process (most concretely: `runGeneratedTest`'s `npx
 * playwright test` loading the full repo `playwright.config.ts`, whose
 * `webServer` array can itself hang spawning an unrelated reference app's
 * dev server) blocked the entire GAP CLI forever, with no error and no
 * way to know why. `killSignal: 'SIGKILL'` (not the default `SIGTERM`)
 * because a stuck child spawned via a shell (`npx`) may itself have
 * spawned further children that ignore SIGTERM — this still isn't a
 * guaranteed kill of the whole tree, but is the strongest signal a single
 * `spawnSync` call can send. This turns an indefinite hang into a bounded,
 * reported failure — it does not change what "passing" means for any of
 * these checks.
 */
function describeTimeout(result: { signal: NodeJS.Signals | null; error?: Error }): string {
  if (result.error && /ETIMEDOUT/.test(result.error.message)) {
    return '\n[GAP] This check was killed after exceeding its timeout — see generated-test-validator.ts.\n';
  }
  if (result.signal) {
    return `\n[GAP] This check was killed by signal ${result.signal} (likely the spawnSync timeout) — see generated-test-validator.ts.\n`;
  }
  return '';
}

/** Formats the generated file with the project's own Prettier config, so it reads like every other file in the repo rather than like a template dump. */
export function formatFile(filePath: string): CheckResult {
  const result = spawnSync('npx', ['prettier', '--write', filePath], {
    encoding: 'utf-8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${describeTimeout(result)}`,
  };
}

/** Whole-project typecheck — the same `tsc --noEmit` `npm run typecheck` runs, so a generated file that breaks the build is caught the same way a hand-written one would be. */
export function typecheckProject(): CheckResult {
  const result = spawnSync('npx', ['tsc', '--noEmit'], {
    encoding: 'utf-8',
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${describeTimeout(result)}`,
  };
}

/** Scoped lint of just the generated file — same eslint config as `npm run lint`, no --fix (this checks, it doesn't silently rewrite). */
export function lintFile(filePath: string): CheckResult {
  const result = spawnSync('npx', ['eslint', filePath], {
    encoding: 'utf-8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${describeTimeout(result)}`,
  };
}

/**
 * Executes the generated spec through the EXISTING GAP execution engine —
 * `resolveExecution`/`toPlaywrightArgs`/`toEnv`, the same functions
 * `gap-test.ts`/`gap.ts` use, just pointed at one file via `testFile`
 * instead of an application's whole test directory. No second execution
 * path.
 */
export function runGeneratedTest(
  application: string,
  environment: string,
  testFile: string,
): CheckResult {
  const resolved = resolveExecution({
    cli: { application, environment, type: 'functional', testFile, headless: true, workers: 1 },
  });
  const args = toPlaywrightArgs(resolved);
  const env = { ...process.env, ...toEnv(resolved) };
  const result = spawnSync('npx', ['playwright', ...args], {
    encoding: 'utf-8',
    env,
    timeout: 180_000,
    killSignal: 'SIGKILL',
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${describeTimeout(result)}`,
  };
}

/** Runs the EXISTING per-application coverage project (`npm run coverage:report`'s underlying invocation) — no second coverage system, just called programmatically after approving a generated test. */
export function runCoverageReport(application: string): CheckResult {
  const result = spawnSync('npx', ['playwright', 'test', '--project=coverage'], {
    encoding: 'utf-8',
    env: { ...process.env, ENV: 'qa', GAP_APPLICATION: application },
    timeout: 180_000,
    killSignal: 'SIGKILL',
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${describeTimeout(result)}`,
  };
}
