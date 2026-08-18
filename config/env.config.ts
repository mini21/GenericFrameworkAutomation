import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { getApplication } from '../src/core/config/application-registry';

export type Environment = 'dev' | 'qa' | 'staging' | 'prod';

export interface AppConfig {
  env: Environment;
  baseUrl: string;
  apiBaseUrl: string;
  logLevel: string;
  apiAuthToken?: string;
  authUsername?: string;
  authPassword?: string;
  db: {
    host?: string;
    port?: number;
    name?: string;
    user?: string;
    password?: string;
  };
}

const VALID_ENVIRONMENTS: Environment[] = ['dev', 'qa', 'staging', 'prod'];
const REQUIRED_KEYS = ['BASE_URL', 'API_BASE_URL'] as const;

function resolveEnvironment(): Environment {
  const env = (process.env.ENV || 'qa').toLowerCase();
  if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
    throw new Error(`Invalid ENV "${env}". Expected one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  }
  return env as Environment;
}

/**
 * Every application's tests live under `applications/<id>/tests/...` —
 * the same convention playwright.config.ts's own test-match globs already
 * rely on. When Playwright is invoked directly against a file under that
 * convention (`npx playwright test applications/hrms/tests/...`, not
 * through the GAP CLI, which already sets BASE_URL/GAP_APPLICATION itself
 * before spawning Playwright), this is the only signal available at
 * config-load time for which application's baseUrl to default to.
 * Deliberately generic — reads config/applications.json via the existing
 * registry, no application ever named here — and deliberately gives up
 * (returns undefined) rather than guessing whenever zero or more than one
 * distinct application id appears across the given arguments, e.g. a
 * whole-suite run with no file filter.
 */
function inferApplicationFromArgv():
  { id: string; baseUrl: string; apiBaseUrl: string } | undefined {
  const ids = new Set<string>();
  for (const arg of process.argv) {
    const match = /applications\/([^/]+)\//.exec(arg);
    if (match) ids.add(match[1]);
  }
  if (ids.size !== 1) return undefined;

  const [id] = ids;
  try {
    const app = getApplication(id);
    return { id, baseUrl: app.baseUrl, apiBaseUrl: app.apiBaseUrl ?? app.baseUrl };
  } catch {
    return undefined; // unregistered id in the path — never guess a URL for it
  }
}

function loadEnvFile(env: Environment): void {
  // Captured before anything else touches process.env: a var already set
  // here came from the real shell/CI environment or a wrapping process
  // (e.g. the GAP CLI injecting an application's BASE_URL before spawning
  // Playwright) — that always wins, including over .env.local and the
  // inferred-application defaults below.
  const explicitlySet = new Set(Object.keys(process.env));

  const envFilePath = path.resolve(__dirname, 'environments', `.env.${env}`);
  if (!fs.existsSync(envFilePath)) {
    throw new Error(`Environment file not found: ${envFilePath}`);
  }
  dotenv.config({ path: envFilePath });

  // Optional local override for secrets not committed to the repo — only
  // fills in keys that weren't explicitly set before this module ran, so
  // it can override the committed .env.<env> placeholder (the common case)
  // without ever clobbering a value the caller deliberately provided.
  const localOverridePath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localOverridePath)) {
    const localValues = dotenv.parse(fs.readFileSync(localOverridePath, 'utf-8'));
    for (const [key, value] of Object.entries(localValues)) {
      if (!explicitlySet.has(key)) {
        process.env[key] = value;
      }
    }
  }

  // A specific application's own baseUrl is a more precise default than
  // the environment-wide placeholder in .env.<env> — apply it wherever the
  // caller didn't explicitly set BASE_URL/API_BASE_URL/GAP_APPLICATION
  // themselves. Runs last so it wins over the generic .env.<env>/.env.local
  // values above for exactly the vars the caller left unset.
  if (!explicitlySet.has('BASE_URL') || !explicitlySet.has('API_BASE_URL')) {
    const inferred = inferApplicationFromArgv();
    if (inferred) {
      if (!explicitlySet.has('BASE_URL')) process.env.BASE_URL = inferred.baseUrl;
      if (!explicitlySet.has('API_BASE_URL')) process.env.API_BASE_URL = inferred.apiBaseUrl;
      if (!explicitlySet.has('GAP_APPLICATION')) process.env.GAP_APPLICATION = inferred.id;
    }
  }
}

function validateRequiredKeys(): void {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid DB_PORT "${value}": expected an integer.`);
  }
  return parsed;
}

function buildConfig(): AppConfig {
  const env = resolveEnvironment();
  loadEnvFile(env);
  validateRequiredKeys();

  return {
    env,
    baseUrl: process.env.BASE_URL as string,
    apiBaseUrl: process.env.API_BASE_URL as string,
    logLevel: process.env.LOG_LEVEL || 'info',
    apiAuthToken: process.env.API_AUTH_TOKEN || undefined,
    authUsername: process.env.AUTH_USERNAME || undefined,
    authPassword: process.env.AUTH_PASSWORD || undefined,
    db: {
      host: process.env.DB_HOST || undefined,
      port: parsePort(process.env.DB_PORT),
      name: process.env.DB_NAME || undefined,
      user: process.env.DB_USER || undefined,
      password: process.env.DB_PASSWORD || undefined,
    },
  };
}

export const config: AppConfig = buildConfig();
