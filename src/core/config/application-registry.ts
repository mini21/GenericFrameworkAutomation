import * as fs from 'fs';
import * as path from 'path';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface ApplicationDefinition {
  name: string;
  baseUrl: string;
  apiBaseUrl?: string;
  modules: string[];
  authProfiles: string[];
  defaultBrowser: BrowserName;
  supportedBrowsers: BrowserName[];
  dataProfiles: string[];
  /** Discovery's default entry path for this application (e.g. "/dashboard.html" for an app with no route at "/") — overridable per-call via --start-path, never required. */
  startPath?: string;
}

export type ApplicationRegistry = Record<string, ApplicationDefinition>;

// process.cwd()-relative, not __dirname-relative: this module is consumed
// both by Playwright (which transforms this file in place from src/) and
// by the compiled GAP CLI (which runs this file's compiled output from
// dist/) — the two have different __dirname values for the same source,
// but both are always invoked with the repo root as cwd via npm scripts.
const REGISTRY_PATH = path.resolve(process.cwd(), 'config', 'applications.json');

let cached: ApplicationRegistry | undefined;

function loadRegistry(): ApplicationRegistry {
  if (!cached) {
    if (!fs.existsSync(REGISTRY_PATH)) {
      throw new Error(`Application registry not found at ${REGISTRY_PATH}`);
    }
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { applications: ApplicationRegistry };
    cached = parsed.applications;
  }
  return cached;
}

export function getApplication(id: string): ApplicationDefinition {
  const registry = loadRegistry();
  const app = registry[id];
  if (!app) {
    throw new Error(
      `Unknown application "${id}". Known applications: ${Object.keys(registry).join(', ')}. ` +
        `Add it to config/applications.json, run "npm run gap:onboard", or pass --url so GAP can ` +
        `register it from what it discovers.`,
    );
  }
  return app;
}

/** Non-throwing existence check — for callers that branch on "should I auto-register this?" rather than treating an unknown id as an error. */
export function hasApplication(id: string): boolean {
  return id in loadRegistry();
}

/** Read-only enumeration of every registered application — used by callers (e.g. the natural-language intent parser) that need to search/list applications rather than look up one by id. */
export function listApplications(): ApplicationRegistry {
  return loadRegistry();
}

const APPLICATION_DIR_PATTERN = /applications[\\/]([^\\/]+)[\\/]/;

/**
 * Every spec file already lives under the `applications/<id>/` convention
 * the rest of the framework relies on (playwright.config.ts's own
 * testMatch globs, execution-resolver.ts, etc.) — so the file itself
 * already names its application unambiguously. Used by fixtures (see
 * test-isolation.fixture.ts, api.fixture.ts) to resolve each test's own
 * target dynamically from its file path, instead of a single global value
 * guessed once at config-load time from CLI argv — the guess is only ever
 * right when the invocation happens to name exactly one application (see
 * config/env.config.ts's inferApplicationFromArgv). Returns undefined for
 * a file with no `applications/<id>/` segment (a framework generic/example
 * spec) or an id not present in the registry — callers keep whatever
 * default they already had in that case.
 */
export function applicationForSpecFile(specFile: string): ApplicationDefinition | undefined {
  const id = APPLICATION_DIR_PATTERN.exec(specFile)?.[1];
  if (!id) return undefined;
  try {
    return getApplication(id);
  } catch {
    return undefined;
  }
}

/**
 * Persists a new application to config/applications.json and updates the
 * in-process cache immediately (so a `getApplication` call later in the
 * same process — generation, execution, coverage — sees it without a
 * restart). Used both by the explicit `gap:onboard` CLI (a human fills in
 * every field) and by GAP's own auto-registration path (a minimal
 * definition derived from a URL/discovery map — see
 * generation-orchestrator.ts) — one write path, so the two never drift.
 * Throws if `id` is already registered; callers that want "register if
 * missing" should check `hasApplication` first.
 */
export function registerApplication(id: string, definition: ApplicationDefinition): void {
  const registry = loadRegistry();
  if (registry[id]) {
    throw new Error(`Application "${id}" already exists in config/applications.json.`);
  }
  const updated: ApplicationRegistry = { ...registry, [id]: definition };
  fs.writeFileSync(
    REGISTRY_PATH,
    `${JSON.stringify({ applications: updated }, null, 2)}\n`,
    'utf-8',
  );
  cached = updated;
}

/**
 * The inverse of registerApplication — e.g. "delete/ignore Amazon" once a
 * discovery/generation experiment is done with it. Goes through the same
 * cached-write path (not a raw file edit): a raw edit leaves this
 * process's in-memory `cached` registry stale, and the NEXT
 * registerApplication call in that same process would silently resurrect
 * the "removed" entry by spreading that stale copy. A no-op for an id
 * that isn't registered — removing something already gone isn't an error.
 */
export function unregisterApplication(id: string): void {
  const registry = loadRegistry();
  if (!(id in registry)) return;
  const updated = { ...registry };
  delete updated[id];
  fs.writeFileSync(
    REGISTRY_PATH,
    `${JSON.stringify({ applications: updated }, null, 2)}\n`,
    'utf-8',
  );
  cached = updated;
}

/**
 * The generic auto-onboarding path: GAP has no fixed application list, so
 * the first time it reaches a URL for an id it hasn't seen — via
 * discovery, generation, or execution — that's enough to register a
 * minimal, working definition (chromium-only, no modules/auth/data
 * profiles yet — those fill in over time from real usage, never guessed
 * here) instead of requiring a human to hand-edit
 * config/applications.json or run gap:onboard first. A no-op when `id` is
 * already registered — every caller can call this unconditionally.
 */
const DEFAULT_DATA_PROFILE = 'qa-default';

export function ensureApplicationRegistered(
  id: string,
  baseUrl: string,
  name?: string,
  startPath?: string,
): void {
  if (hasApplication(id)) return;
  registerApplication(id, {
    name: name ?? id,
    baseUrl,
    modules: [],
    authProfiles: [],
    defaultBrowser: 'chromium',
    supportedBrowsers: ['chromium'],
    dataProfiles: [DEFAULT_DATA_PROFILE],
    ...(startPath && startPath !== '/' ? { startPath } : {}),
  });
  // Every generated test's own template unconditionally loads this
  // application's default data profile (see code-generator.ts) — the same
  // scaffold gap:onboard already writes for a manually-onboarded app, so a
  // never-before-seen application doesn't fail on data it doesn't need yet
  // (an empty profile is valid; a step that genuinely needs a credential
  // GAP can't derive already asks for it via resolveMissingValue).
  const dataFile = path.resolve(
    process.cwd(),
    'applications',
    id,
    'data',
    `${DEFAULT_DATA_PROFILE}.json`,
  );
  if (!fs.existsSync(dataFile)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, `${JSON.stringify({}, null, 2)}\n`, 'utf-8');
  }
}
