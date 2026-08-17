import * as fs from 'fs';
import * as path from 'path';

/**
 * Writes a freshly-generated spec so it can be type-checked/linted/run for
 * validation — this is deliberately a REAL file on disk at its real target
 * path (Playwright/tsc need that to resolve project config correctly), not
 * a temp copy. It only becomes "permanent" in the sense of section 12/13
 * once the human approves; until then the caller must call
 * `deleteGeneratedFile` on rejection so nothing unapproved survives.
 */
export function writeGeneratedFile(filePath: string, code: string): void {
  if (fs.existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing file: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, code, 'utf-8');
}

export function deleteGeneratedFile(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}
