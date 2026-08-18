import { ApplicationMap, PageMap } from './discovery-types';

/** Buttons/inputs/links/selects/checkboxes found on one page. */
export function pageElementCount(page: PageMap): number {
  return (
    page.buttons.length +
    page.inputs.length +
    page.links.length +
    page.selects.length +
    page.checkboxes.length
  );
}

/**
 * Total interactive-element count across every page — the generic,
 * app-agnostic signal that a crawl actually reached real application
 * content rather than an empty/error/interstitial page. Shared by every
 * caller that needs to decide whether a crawl result is usable
 * (site-crawler.ts's own retry, application-map-writer.ts's overwrite
 * guard, generation-orchestrator.ts's discover-or-reuse decision) so
 * "usable" means exactly the same thing everywhere.
 */
export function totalElementCount(map: ApplicationMap): number {
  return map.pages.reduce((sum, page) => sum + pageElementCount(page), 0);
}

export function isMapUsable(map: ApplicationMap): boolean {
  return totalElementCount(map) > 0;
}
