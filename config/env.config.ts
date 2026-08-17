import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

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

function loadEnvFile(env: Environment): void {
  // Captured before anything else touches process.env: a var already set
  // here came from the real shell/CI environment or a wrapping process
  // (e.g. the GAP CLI injecting an application's BASE_URL before spawning
  // Playwright) — that always wins, including over .env.local below.
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
