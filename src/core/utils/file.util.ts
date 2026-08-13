import * as fs from 'fs';
import * as path from 'path';

export function readJson<T = unknown>(filePath: string): T {
  const content = fs.readFileSync(path.resolve(filePath), 'utf-8');
  return JSON.parse(content) as T;
}

export function writeJson(filePath: string, data: unknown): void {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf-8');
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

export function exists(filePath: string): boolean {
  return fs.existsSync(path.resolve(filePath));
}
