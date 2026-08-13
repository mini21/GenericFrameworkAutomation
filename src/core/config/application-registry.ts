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
        `Add it to config/applications.json or run "npm run gap:onboard".`,
    );
  }
  return app;
}
