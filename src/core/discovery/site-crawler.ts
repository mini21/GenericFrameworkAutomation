import { BrowserContext } from 'playwright';
import { mapPage } from './page-crawler';
import { ApplicationMap, PageMap } from './discovery-types';

export interface CrawlOptions {
  application: string;
  baseUrl: string;
  startPath: string;
  maxPages: number;
}

// Common non-page link targets — following these would trigger a download
// or leave the browser rather than reveal another page to map.
const SKIP_EXTENSIONS = [
  '.pdf',
  '.zip',
  '.csv',
  '.xlsx',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.mp4',
];

function normalizePath(url: string): string {
  return new URL(url).pathname || '/';
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function isCrawlable(href: string): boolean {
  if (!href) return false;
  if (/^(mailto|tel|javascript):/i.test(href)) return false;
  const lower = href.toLowerCase();
  return !SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Same-origin, page-capped BFS crawl starting from `startPath` — never
 * follows a link outside `baseUrl`'s origin, so the only domain this ever
 * touches is the one explicitly provided by the caller. Each page is
 * mapped via `mapPage` (which re-verifies every click/fill-shaped element
 * through the existing LocatorResolver); a page that fails to load is
 * recorded in `errors` and the crawl continues rather than aborting.
 */
export async function crawlApplication(
  context: BrowserContext,
  options: CrawlOptions,
): Promise<ApplicationMap> {
  const origin = new URL(options.baseUrl).origin;
  const startUrl = new URL(options.startPath, options.baseUrl).toString();

  const queue: string[] = [startUrl];
  const visited = new Set<string>();
  const pages: PageMap[] = [];
  const errors: ApplicationMap['errors'] = [];

  const page = await context.newPage();
  try {
    while (queue.length > 0 && visited.size < options.maxPages) {
      const target = queue.shift() as string;
      const key = normalizePath(target);
      if (visited.has(key)) continue;
      visited.add(key);

      try {
        await page.goto(target, { waitUntil: 'domcontentloaded' });
      } catch (error) {
        errors.push({
          url: target,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      pages.push(await mapPage(page));

      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') || ''));

      for (const href of hrefs) {
        if (!isCrawlable(href)) continue;
        let resolved: string;
        try {
          resolved = new URL(href, page.url()).toString();
        } catch {
          continue;
        }
        if (!isSameOrigin(resolved, origin)) continue;
        if (visited.has(normalizePath(resolved))) continue;
        queue.push(resolved);
      }
    }
  } finally {
    await page.close();
  }

  return {
    application: options.application,
    baseUrl: options.baseUrl,
    generatedAt: new Date().toISOString(),
    pages,
    errors,
  };
}
