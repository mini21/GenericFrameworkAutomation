import { spawnSync } from 'node:child_process';
import { resolveExecution, toPlaywrightArgs, toEnv } from '../execution/execution-resolver';

export interface CheckResult {
  passed: boolean;
  output: string;
}

/** Formats the generated file with the project's own Prettier config, so it reads like every other file in the repo rather than like a template dump. */
export function formatFile(filePath: string): CheckResult {
  const result = spawnSync('npx', ['prettier', '--write', filePath], { encoding: 'utf-8' });
  return { passed: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Whole-project typecheck — the same `tsc --noEmit` `npm run typecheck` runs, so a generated file that breaks the build is caught the same way a hand-written one would be. */
export function typecheckProject(): CheckResult {
  const result = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf-8' });
  return { passed: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Scoped lint of just the generated file — same eslint config as `npm run lint`, no --fix (this checks, it doesn't silently rewrite). */
export function lintFile(filePath: string): CheckResult {
  const result = spawnSync('npx', ['eslint', filePath], { encoding: 'utf-8' });
  return { passed: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
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
  const result = spawnSync('npx', ['playwright', ...args], { encoding: 'utf-8', env });
  return { passed: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Runs the EXISTING per-application coverage project (`npm run coverage:report`'s underlying invocation) — no second coverage system, just called programmatically after approving a generated test. */
export function runCoverageReport(application: string): CheckResult {
  const result = spawnSync('npx', ['playwright', 'test', '--project=coverage'], {
    encoding: 'utf-8',
    env: { ...process.env, ENV: 'qa', GAP_APPLICATION: application },
  });
  return { passed: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
