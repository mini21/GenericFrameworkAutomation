import * as fs from 'fs';
import * as path from 'path';
import { ApplicationMap } from './discovery-types';

/** Writes applications/<id>/discovery/application-map.json, creating the directory if needed. */
export function writeApplicationMap(map: ApplicationMap): string {
  const dir = path.resolve(process.cwd(), 'applications', map.application, 'discovery');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'application-map.json');
  fs.writeFileSync(filePath, `${JSON.stringify(map, null, 2)}\n`, 'utf-8');
  return filePath;
}

const MAX_NAMES_PER_PAGE = 12;

/** Terse, human-readable digest of an ApplicationMap — the printed summary a Manual QA reviews. */
export function formatSummary(map: ApplicationMap): string {
  const lines: string[] = [`Application: ${map.application}`, '', 'Pages:'];

  for (const p of map.pages) {
    lines.push(`  ${p.pageName}`);
    const names = Array.from(
      new Set([
        ...p.inputs.map((e) => e.name),
        ...p.selects.map((e) => e.name),
        ...p.checkboxes.map((e) => e.name),
        ...p.buttons.map((e) => e.name),
        ...p.links.map((e) => e.name),
      ]),
    );
    for (const name of names.slice(0, MAX_NAMES_PER_PAGE)) {
      lines.push(`    - ${name}`);
    }
    if (names.length > MAX_NAMES_PER_PAGE) {
      lines.push(`    ... and ${names.length - MAX_NAMES_PER_PAGE} more`);
    }
    lines.push('');
  }

  if (map.errors.length > 0) {
    lines.push('Pages that failed to load:');
    for (const e of map.errors) lines.push(`  - ${e.url}: ${e.message}`);
    lines.push('');
  }

  lines.push(`${map.pages.length} page(s) mapped.`);
  return lines.join('\n');
}
