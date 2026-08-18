import { BrowserContext } from 'playwright';
import { mapPage } from './page-crawler';
import { ApplicationMap, PageMap } from './discovery-types';
import { pageElementCount } from './map-analysis';

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
      const isFirstPage = pages.length === 0;

      let response;
      try {
        response = await page.goto(target, { waitUntil: 'domcontentloaded' });
      } catch (error) {
        errors.push({
          url: target,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      // A non-2xx/3xx response (bot-check, rate-limit, server error) still
      // navigates successfully as far as Playwright's own goto() is
      // concerned — it doesn't throw on HTTP status alone — so this is
      // recorded as a diagnostic rather than treated as a hard failure: an
      // app that genuinely serves a real page with a non-2xx status (some
      // do for an unauthenticated route) still gets mapped normally below.
      if (response && !response.ok()) {
        errors.push({
          url: target,
          message: `HTTP ${response.status()} ${response.statusText()}`.trim(),
        });
      }

      let mapped = await mapPage(page);

      // Generic recovery for "the page hadn't actually finished rendering
      // yet" — a client-rendered app (or an interim bot-check/interstitial
      // that resolves itself via JS) can leave domcontentloaded's snapshot
      // essentially empty even on what will become a perfectly normal page.
      // Only worth the extra wait for the crawl's own entry point: if THAT
      // page comes back with nothing to show for it, waiting for the
      // network to settle and re-reading the DOM once is cheap; doing this
      // for every page would slow down a normal crawl for no benefit, since
      // a genuinely content-free page stays content-free either way.
      if (isFirstPage && pageElementCount(mapped) === 0) {
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const retried = await mapPage(page);
        if (pageElementCount(retried) > 0) mapped = retried;
      }

      pages.push(mapped);

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
