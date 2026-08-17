import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BrowserName } from '../config/application-registry';

export type TestType = 'smoke' | 'regression' | 'sanity' | 'functional';

export interface ExecutionManifest {
  application?: string;
  environment?: string;
  module?: string;
  execution?: {
    type?: TestType;
    browsers?: BrowserName[];
    headless?: boolean;
    workers?: number;
    retries?: number;
  };
  tags?: string[];
  dataProfile?: string;
  authentication?: { profile?: string };
}

/** Loads a .yml/.yaml/.json execution manifest. Every field is optional — the resolver fills gaps from CLI/env/application defaults. */
export function loadManifest(filePath: string): ExecutionManifest {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Execution manifest not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  const ext = path.extname(resolved).toLowerCase();

  if (ext === '.yml' || ext === '.yaml') {
    return (yaml.load(raw) as ExecutionManifest) ?? {};
  }
  if (ext === '.json') {
    return JSON.parse(raw) as ExecutionManifest;
  }
  throw new Error(
    `Unsupported manifest extension "${ext}" for ${resolved}. Use .yml, .yaml, or .json.`,
  );
}
