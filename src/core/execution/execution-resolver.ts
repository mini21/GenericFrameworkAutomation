import { getApplication, BrowserName } from '../config/application-registry';
import { ExecutionManifest, TestType } from './execution-manifest';

const TEST_TYPE_TAG: Record<TestType, string> = {
  smoke: '@smoke',
  regression: '@regression',
  sanity: '@sanity',
  functional: '@functional',
};

/** Explicit inputs, one per source. Any field may be undefined at any level — the resolver fills gaps per the documented precedence. */
export interface ResolverInputs {
  cli?: Partial<CliOverrides>;
  env?: NodeJS.ProcessEnv;
  manifest?: ExecutionManifest;
}

export interface CliOverrides {
  application?: string;
  environment?: string;
  module?: string;
  type?: TestType;
  browsers?: BrowserName[];
  headless?: boolean;
  workers?: number;
  retries?: number;
  tags?: string[];
  dataProfile?: string;
  authProfile?: string;
  /** Exact spec file to run instead of the whole `applications/<app>/tests` tree — used to validate/execute one freshly-generated test without a second execution path. */
  testFile?: string;
}

export interface ResolvedExecution {
  application: string;
  environment: string;
  module?: string;
  type: TestType;
  browsers: BrowserName[];
  headless: boolean;
  workers?: number;
  retries?: number;
  tags: string[];
  dataProfile?: string;
  authProfile?: string;
  testFile?: string;
}

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  return values.find((v) => v !== undefined);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Resolves manifest/CLI/env inputs into a fully-populated execution plan.
 * Precedence (highest wins): CLI > environment variables > manifest >
 * application defaults from the registry.
 */
export function resolveExecution({
  cli = {},
  env = {},
  manifest = {},
}: ResolverInputs): ResolvedExecution {
  const envBrowsers = parseList(env.GAP_BROWSER);
  const envTags = parseList(env.GAP_TAGS);

  const application = firstDefined(cli.application, env.GAP_APPLICATION, manifest.application);
  if (!application) {
    throw new Error(
      'No application specified. Pass --application=<id>, set GAP_APPLICATION, or set "application" in the manifest.',
    );
  }
  const appDefinition = getApplication(application);

  const environment = firstDefined(
    cli.environment,
    env.GAP_ENVIRONMENT,
    manifest.environment,
    'qa',
  ) as string;
  const module_ = firstDefined(cli.module, env.GAP_MODULE, manifest.module);
  const type = firstDefined(
    cli.type,
    env.GAP_TYPE as TestType | undefined,
    manifest.execution?.type,
    'smoke',
  ) as TestType;

  const requestedBrowsers = firstDefined(
    cli.browsers,
    envBrowsers as BrowserName[] | undefined,
    manifest.execution?.browsers,
  ) ?? [appDefinition.defaultBrowser];
  const browsers =
    requestedBrowsers.length === 1 && requestedBrowsers[0] === ('all' as BrowserName)
      ? appDefinition.supportedBrowsers
      : requestedBrowsers;
  for (const browser of browsers) {
    if (!appDefinition.supportedBrowsers.includes(browser)) {
      throw new Error(
        `Application "${application}" does not support browser "${browser}". Supported: ${appDefinition.supportedBrowsers.join(', ')}.`,
      );
    }
  }

  const headless = firstDefined(
    cli.headless,
    parseBoolean(env.GAP_HEADLESS),
    manifest.execution?.headless,
    true,
  ) as boolean;
  const workers = firstDefined(
    cli.workers,
    parseNumber(env.GAP_WORKERS),
    manifest.execution?.workers,
  );
  const retries = firstDefined(
    cli.retries,
    parseNumber(env.GAP_RETRIES),
    manifest.execution?.retries,
  );
  const typeExplicit =
    cli.type !== undefined || env.GAP_TYPE !== undefined || manifest.execution?.type !== undefined;
  const explicitTags = firstDefined(cli.tags, envTags, manifest.tags) ?? [];
  const dataProfile = firstDefined(
    cli.dataProfile,
    env.GAP_DATA_PROFILE,
    manifest.dataProfile,
    appDefinition.dataProfiles[0],
  );
  const authProfile = firstDefined(
    cli.authProfile,
    env.GAP_AUTH_PROFILE,
    manifest.authentication?.profile,
  );

  // The type tag is only injected when the type is a real user/manifest choice
  // (or nothing else narrowed the run at all). Once the caller names explicit
  // tags without also naming a type, `type` above has silently defaulted to
  // 'smoke' just to satisfy TestType's return shape — ANDing @smoke into that
  // request would wrongly exclude every non-smoke-tagged test (e.g. a
  // generated test's own stable @hrms.<module>.generated.<n> tag) instead of
  // running exactly what was asked for.
  const tags =
    explicitTags.length > 0 && !typeExplicit
      ? Array.from(new Set(explicitTags))
      : Array.from(new Set([TEST_TYPE_TAG[type], ...explicitTags]));

  return {
    application,
    environment,
    module: module_,
    type,
    browsers,
    headless,
    workers,
    retries,
    tags,
    dataProfile,
    authProfile,
    testFile: cli.testFile,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translates a resolved execution plan into native Playwright CLI
 * arguments — projects, --grep, workers, retries, headed/headless. No
 * custom test runner: this is purely argument construction.
 */
export function toPlaywrightArgs(resolved: ResolvedExecution): string[] {
  const args: string[] = [
    'test',
    resolved.testFile ?? `applications/${resolved.application}/tests`,
  ];

  for (const browser of resolved.browsers) {
    args.push(`--project=${browser}`);
  }

  const requiredTags = [...resolved.tags];
  if (resolved.module) {
    requiredTags.push(`@module.${resolved.module}`);
  }
  if (requiredTags.length > 0) {
    // Lookahead-composed AND: every required tag must be present, not just any one of them.
    const pattern = requiredTags.map((tag) => `(?=.*${escapeRegExp(tag)})`).join('');
    args.push(`--grep=${pattern}`);
  }

  if (resolved.workers !== undefined) {
    args.push(`--workers=${resolved.workers}`);
  }
  if (resolved.retries !== undefined) {
    args.push(`--retries=${resolved.retries}`);
  }
  if (!resolved.headless) {
    args.push('--headed');
  }

  return args;
}

/** Env vars the CLI injects into the spawned Playwright process so config/env.config.ts and fixtures pick up the right target automatically. */
export function toEnv(resolved: ResolvedExecution): NodeJS.ProcessEnv {
  const appDefinition = getApplication(resolved.application);
  return {
    ENV: resolved.environment,
    BASE_URL: appDefinition.baseUrl,
    // An application with no separate API host (the common case — e.g.
    // HRMS serves both from the same origin) simply never sets
    // `apiBaseUrl`; falling back to `baseUrl` (not '') keeps that legal
    // and keeps env.config.ts's required-key check meaningful — an empty
    // string is a present-but-falsy env var, which reads as "explicitly
    // set to nothing" rather than "not configured, please default it".
    API_BASE_URL: appDefinition.apiBaseUrl ?? appDefinition.baseUrl,
    GAP_APPLICATION: resolved.application,
    GAP_MODULE: resolved.module ?? '',
    GAP_DATA_PROFILE: resolved.dataProfile ?? '',
    GAP_AUTH_PROFILE: resolved.authProfile ?? '',
  };
}
