import * as fs from 'fs';
import * as path from 'path';
import { ApplicationMap } from './discovery-types';
import { isMapUsable } from './map-analysis';

function mapFilePath(application: string): string {
  return path.resolve(
    process.cwd(),
    'applications',
    application,
    'discovery',
    'application-map.json',
  );
}

/** Writes applications/<id>/discovery/application-map.json, creating the directory if needed. */
export function writeApplicationMap(map: ApplicationMap): string {
  const filePath = mapFilePath(map.application);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(map, null, 2)}\n`, 'utf-8');
  return filePath;
}

/** The application's existing discovery map on disk, if any — undefined for a never-discovered application, not a thrown error. */
export function readApplicationMap(application: string): ApplicationMap | undefined {
  const filePath = mapFilePath(application);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ApplicationMap;
  } catch {
    return undefined;
  }
}

export interface SafeWriteResult {
  written: boolean;
  filePath: string;
  /** Set only when written=false — why this crawl was rejected and the existing map was kept untouched. */
  skippedReason?: string;
}

/**
 * The single write path every discovery entry point (cli/gap-discover.ts,
 * cli/gap.ts's handleDiscover, generation-orchestrator.ts's re-discovery)
 * shares — a fresh crawl that found nothing usable (see map-analysis.ts)
 * NEVER overwrites an already-usable existing map: a bot-check/error/
 * interstitial page from one transient run must not destroy a good crawl
 * from an earlier one. A first-ever discovery (nothing on disk yet) still
 * gets written even if empty — there's nothing to protect, and the caller
 * needs to see what was actually found (or not found) to diagnose why.
 */
export function writeApplicationMapSafely(map: ApplicationMap): SafeWriteResult {
  const filePath = mapFilePath(map.application);

  if (!isMapUsable(map)) {
    const existing = readApplicationMap(map.application);
    if (existing && isMapUsable(existing)) {
      const first = map.pages[0];
      return {
        written: false,
        filePath,
        skippedReason:
          `This crawl found 0 buttons/inputs/links/selects/checkboxes across ${map.pages.length} ` +
          `page(s)${first ? ` (e.g. "${first.pageName}" at ${first.path})` : ''} — likely a bot-check, ` +
          'error, or interstitial page rather than the real application, or the start path needs ' +
          `authentication. Keeping the existing map at ${filePath} (last generated ${existing.generatedAt}) ` +
          'instead of overwriting it with an unusable result.',
      };
    }
  }

  writeApplicationMap(map);
  return { written: true, filePath };
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
