import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads applications/<application>/data/<profile>.json — generic core
 * knows only the file convention, nothing about any application's data shape.
 */
export function loadDataProfile<T = Record<string, unknown>>(
  application: string,
  profile: string,
): T {
  const filePath = path.resolve(
    process.cwd(),
    'applications',
    application,
    'data',
    `${profile}.json`,
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data profile not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}
