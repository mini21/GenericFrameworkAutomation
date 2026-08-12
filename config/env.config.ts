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
  const envFilePath = path.resolve(__dirname, 'environments', `.env.${env}`);
  if (!fs.existsSync(envFilePath)) {
    throw new Error(`Environment file not found: ${envFilePath}`);
  }
  dotenv.config({ path: envFilePath });

  // Optional local override for secrets not committed to the repo.
  const localOverridePath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localOverridePath)) {
    dotenv.config({ path: localOverridePath, override: true });
  }
}

function validateRequiredKeys(): void {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
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
    db: {
      host: process.env.DB_HOST || undefined,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      name: process.env.DB_NAME || undefined,
      user: process.env.DB_USER || undefined,
      password: process.env.DB_PASSWORD || undefined,
    },
  };
}

export const config: AppConfig = buildConfig();
