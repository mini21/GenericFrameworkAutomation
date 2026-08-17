import { getApplication } from '../config/application-registry';
import { resolveExecution, CliOverrides, ResolvedExecution } from '../execution/execution-resolver';
import { ENVIRONMENT_KEYWORDS, TEST_TYPE_KEYWORDS } from './vocabulary';

export class GapUserError extends Error {}

const VALID_ENVIRONMENTS = Object.keys(ENVIRONMENT_KEYWORDS);
const VALID_TYPES = Object.keys(TEST_TYPE_KEYWORDS);

/**
 * Semantic checks the deterministic parsers can't make on their own — e.g.
 * module membership depends on which application ended up resolved, which
 * isn't known until both fields are parsed. Runs before `resolveExecution`
 * so invalid input produces a QA-friendly message instead of Playwright's
 * own "no tests found" surprise further downstream.
 */
export function validateIntent(intent: Partial<CliOverrides>): void {
  if (intent.environment && !VALID_ENVIRONMENTS.includes(intent.environment)) {
    throw new GapUserError(
      `Unknown environment "${intent.environment}". Supported environments: ${VALID_ENVIRONMENTS.join(', ')}.`,
    );
  }
  if (intent.type && !VALID_TYPES.includes(intent.type)) {
    throw new GapUserError(
      `Unknown test type "${intent.type}". Supported test types: ${VALID_TYPES.join(', ')}.`,
    );
  }
  if (intent.application && intent.module) {
    const app = getApplication(intent.application);
    if (!app.modules.includes(intent.module)) {
      throw new GapUserError(
        `Application "${intent.application}" has no module "${intent.module}". ` +
          `Available modules: ${app.modules.join(', ')}.`,
      );
    }
  }
}

export type FinalizeResult =
  { ok: true; resolved: ResolvedExecution } | { ok: false; message: string };

/**
 * Validates and hands the normalized intent to the EXISTING GAP execution
 * engine (`resolveExecution`) — the natural-language/structured-input
 * layers never build a `ResolvedExecution` themselves. Both this function's
 * own validation errors and any error `resolveExecution`/`getApplication`
 * throw (unknown application, unsupported browser, ...) come back the same
 * way, since both are already written as QA-friendly messages.
 */
export function finalize(intent: Partial<CliOverrides>): FinalizeResult {
  try {
    validateIntent(intent);
    const resolved = resolveExecution({ cli: intent });
    return { ok: true, resolved };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function formatPlan(resolved: ResolvedExecution): string {
  const app = getApplication(resolved.application);
  const lines = [
    `Application: ${app.name} (${resolved.application})`,
    `Environment: ${resolved.environment.toUpperCase()}`,
    `Module:      ${resolved.module ?? '(all modules)'}`,
    `Test Type:   ${resolved.type}`,
    `Browser(s):  ${resolved.browsers.join(', ')}`,
  ];
  if (resolved.tags.length > 0) {
    lines.push(`Tags:        ${resolved.tags.join(', ')}`);
  }
  return lines.join('\n');
}
