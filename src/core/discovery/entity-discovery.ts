import { Locator, Page } from '@playwright/test';

interface AnchorEvidence {
  href: string;
  text: string;
  ownClass: string;
  parentTag: string;
  parentClass: string;
}

// Same "minimal per-element typing, cast for anything beyond it" pattern
// already used throughout page-crawler.ts (this project's tsconfig has no
// "dom" lib — see that file's own comments) — `parentElement` isn't part
// of Playwright's own minimal evaluateAll element type, so it's cast.
async function collectAnchorEvidence(page: Page): Promise<AnchorEvidence[]> {
  return page.locator('a[href]').evaluateAll((elements) =>
    elements.map((el) => {
      const withParent = el as unknown as {
        parentElement?: { tagName: string; getAttribute: (name: string) => string | null } | null;
      };
      const parent = withParent.parentElement;
      return {
        href: el.getAttribute('href') || '',
        text: (el.textContent || '').trim(),
        ownClass: (el.getAttribute('class') || '').trim(),
        parentTag: parent ? parent.tagName.toLowerCase() : '',
        parentClass: parent ? (parent.getAttribute('class') || '').trim() : '',
      };
    }),
  );
}

function normalizedClass(cls: string): string {
  return cls.split(/\s+/).filter(Boolean).sort().join('.');
}

/** The class-qualified "shape" a candidate anchor exposes at a given depth — the anchor itself (0) or its immediate parent (1). Never a bare, unqualified tag (too generic to trust as a repetition signal). */
function shapeKey(a: AnchorEvidence, depth: 0 | 1): string | null {
  if (depth === 0) {
    const cls = normalizedClass(a.ownClass);
    return cls ? `a.${cls}` : null;
  }
  const cls = normalizedClass(a.parentClass);
  return cls ? `${a.parentTag || '*'}.${cls}` : null;
}

/**
 * A GENERIC structural fallback for real applications GAP has no markup
 * control over (e.g. a live third-party site with no data-entity
 * convention — see selectEntity below): among the page's own links, the
 * largest group that (a) shares a repeated, CSS-class-qualified ancestor
 * shape at a shallow depth (the anchor itself, or its immediate parent —
 * covers the overwhelming majority of real card/list-item markup) and
 * (b) points to mostly DISTINCT destinations — the generic, app-agnostic
 * signature of "a genuine content list" (search results, a product grid,
 * an article listing) as opposed to a handful of incidental same-shaped
 * links (e.g. one repeated nav item). Nothing here is domain-specific —
 * no "product" vocabulary, no site-specific selectors. Document order,
 * deduplicated by href.
 */
export async function discoverEntityCandidates(
  page: Page,
): Promise<{ name: string; href: string }[]> {
  const raw = await collectAnchorEvidence(page);
  const anchors = raw.filter((a) => a.text.length > 1 && a.href);

  let best: AnchorEvidence[] = [];
  for (const depth of [0, 1] as const) {
    const groups = new Map<string, AnchorEvidence[]>();
    for (const a of anchors) {
      const key = shapeKey(a, depth);
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(a);
      else groups.set(key, [a]);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const uniqueHrefs = new Set(members.map((m) => m.href));
      if (uniqueHrefs.size < Math.max(2, Math.ceil(members.length * 0.6))) continue; // not a genuine distinct-destination list
      if (members.length > best.length) best = members;
    }
  }

  const seen = new Set<string>();
  const result: { name: string; href: string }[] = [];
  for (const a of best) {
    if (seen.has(a.href)) continue;
    seen.add(a.href);
    result.push({ name: a.text, href: a.href });
  }
  return result;
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Picks a deterministic representative "item" candidate — a product card,
 * a search result, a list row, ... — on the CURRENT live page, for GAP's
 * "Select a/an <item>" step (see ui-mapper.ts). A real results/listing
 * page frequently only exists AFTER a live action (a search, a filter) —
 * discovery-time static analysis genuinely cannot see it, so this
 * resolves live, at test-run time, against whatever the actual current
 * page is (the "rediscover the current page" execution model), never a
 * discovery-time snapshot.
 *
 * Two tiers of evidence, tried in order — never text-only, never `.first()`
 * to suppress a genuine ambiguity between UNRELATED candidates (picking a
 * representative from a real repeated LIST is a different, safe operation
 * from resolving a name collision):
 *
 * 1. The explicit, opt-in `data-entity="<type>"` markup convention (see
 *    page-crawler.ts's collectEntityItems) — the strongest signal when an
 *    application provides it.
 * 2. discoverEntityCandidates' generic structural fallback, above.
 *
 * Throws a clear, honest error — never a silent empty selection, never a
 * fabricated entity — when NEITHER signal finds anything: the SAME safety
 * contract as LocatorResolver's own LocatorResolutionError.
 */
export async function selectEntity(page: Page, entityType: string): Promise<Locator> {
  const explicit = page.locator(`[data-entity="${entityType}"]`);
  if ((await explicit.count()) > 0) return explicit.first();

  const candidates = await discoverEntityCandidates(page);
  if (candidates.length === 0) {
    throw new Error(
      `selectEntity: found no discovered "${entityType}"-like entity on the current page ` +
        `(${page.url()}) — neither an explicit data-entity="${entityType}" marker, nor a ` +
        'repeated group of links pointing to distinct destinations. Nothing to select safely.',
    );
  }
  const [first] = candidates;
  return page.locator(`a[href="${escapeAttrValue(first.href)}"]`).first();
}
