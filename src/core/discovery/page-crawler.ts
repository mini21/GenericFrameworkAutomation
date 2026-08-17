import { Page } from 'playwright';
import { LocatorResolver } from '../locator/locator-resolver';
import { DiscoveredElement, PageMap } from './discovery-types';

// Matches one Locator.ariaSnapshot() line, e.g. `- button "Login"` or
// `- heading "Employee Leave Management" [level=1]` — the name is optional
// since structural landmarks (table/form/navigation) are frequently
// unnamed, e.g. `- table:` introducing nested rowgroup/row children.
// Nesting/indentation is deliberately ignored otherwise — Phase 1 only
// needs a flat role+name catalog per page, not the tree's hierarchy.
const ARIA_LINE = /^\s*-\s*([a-z][a-z0-9]*)(?:\s+"([^"]*)")?/i;

const CLICK_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab']);
const FILL_ROLES = new Set(['textbox', 'searchbox', 'spinbutton']);
const SELECT_ROLES = new Set(['combobox', 'listbox']);

function parseAriaSnapshot(snapshot: string): { role: string; name: string }[] {
  const entries: { role: string; name: string }[] = [];
  for (const line of snapshot.split('\n')) {
    const match = ARIA_LINE.exec(line);
    if (!match) continue;
    const [, role, name] = match;
    entries.push({ role: role.toLowerCase(), name: name ?? '' });
  }
  return entries;
}

async function verify(
  resolver: LocatorResolver,
  name: string,
  action: 'click' | 'fill',
): Promise<DiscoveredElement['verified']> {
  try {
    const { resolution } = await resolver.resolve({ name }, action);
    return {
      strategy: resolution.strategy,
      confidence: resolution.confidence,
      resolvedLocator: resolution.resolvedLocator,
    };
  } catch {
    // Not uniquely/usably resolvable right now (duplicate name, hidden,
    // disabled, ...) — still reported in the map, just without a `verified`
    // block, so the map stays honest about what's actually clickable/fillable.
    return undefined;
  }
}

/**
 * Maps a single already-navigated page: what's on it, categorized by ARIA
 * role, with every click/fill-shaped element re-verified through the
 * EXISTING LocatorResolver (not just read off the accessibility tree) so
 * the map only reports names that are proven to resolve uniquely right now.
 */
export async function mapPage(page: Page): Promise<PageMap> {
  const [title, ariaSnapshot, testIds] = await Promise.all([
    page.title(),
    page.locator('body').ariaSnapshot(),
    page
      .locator('[data-testid]')
      .evaluateAll((elements) =>
        elements
          .map((el) => el.getAttribute('data-testid'))
          .filter((value): value is string => Boolean(value)),
      ),
  ]);

  const resolver = new LocatorResolver(page);

  const buttons: DiscoveredElement[] = [];
  const links: DiscoveredElement[] = [];
  const inputs: DiscoveredElement[] = [];
  const selects: DiscoveredElement[] = [];
  const checkboxes: DiscoveredElement[] = [];
  const headings: string[] = [];
  let tables = 0;
  let forms = 0;
  let navigation = 0;

  const seen = new Set<string>();
  for (const { role, name } of parseAriaSnapshot(ariaSnapshot)) {
    // Structural landmarks are counted regardless of whether they carry an
    // accessible name — most tables/forms/nav regions don't.
    if (role === 'table') {
      tables++;
      continue;
    }
    if (role === 'form') {
      forms++;
      continue;
    }
    if (role === 'navigation') {
      navigation++;
      continue;
    }
    if (!name.trim()) continue; // every remaining category needs a name to be useful

    const key = `${role}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (role === 'heading') {
      headings.push(name);
    } else if (role === 'checkbox' || role === 'radio') {
      checkboxes.push({ role, name, verified: await verify(resolver, name, 'click') });
    } else if (role === 'link') {
      links.push({ role, name, verified: await verify(resolver, name, 'click') });
    } else if (CLICK_ROLES.has(role)) {
      buttons.push({ role, name, verified: await verify(resolver, name, 'click') });
    } else if (FILL_ROLES.has(role)) {
      inputs.push({ role, name, verified: await verify(resolver, name, 'fill') });
    } else if (SELECT_ROLES.has(role)) {
      // Neither click nor fill fits a <select> — reported unverified, on purpose.
      selects.push({ role, name });
    }
  }

  const path = new URL(page.url()).pathname || '/';
  const pageName = title || headings[0] || path;

  return {
    path,
    url: page.url(),
    title,
    pageName,
    headings,
    buttons,
    links,
    inputs,
    selects,
    checkboxes,
    tables,
    forms,
    navigation,
    testIds: testIds.slice(0, 20),
    ariaSnapshot,
  };
}
