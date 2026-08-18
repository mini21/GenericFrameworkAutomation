import { Page } from 'playwright';
import { LocatorResolver } from '../locator/locator-resolver';
import { ConfirmationRegion, DiscoveredElement, PageMap } from './discovery-types';

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

interface FormFieldEvidence {
  /** Best-effort label text (label[for]/aria-label/placeholder) -> HTML input `type` (or "select"/"textarea"). Generic — no app-specific selectors. */
  inputTypesByLabel: Record<string, string>;
  /** Lowercased accessible text of every native submit control (`<button>` with an implicit/explicit type="submit", or `<input type="submit">`) — an app-agnostic "this is the primary action" signal. */
  submitLabels: string[];
}

// Uses Locator.evaluateAll (Playwright's own minimal element typings, no
// project-wide "dom" lib needed — same pattern already used for `testIds`/
// link-extraction elsewhere in this module) rather than page.evaluate,
// which would need `document`/`HTMLInputElement` types this project's
// tsconfig doesn't provide.
async function collectFormFieldEvidence(page: Page): Promise<FormFieldEvidence> {
  const fields = await page.locator('input, textarea, select').evaluateAll((elements) =>
    elements.map((el) => {
      const withLabels = el as unknown as { labels?: { textContent: string | null }[] };
      let label = '';
      if (withLabels.labels && withLabels.labels.length > 0 && withLabels.labels[0].textContent) {
        label = withLabels.labels[0].textContent;
      } else if (el.getAttribute('aria-label')) {
        label = el.getAttribute('aria-label') ?? '';
      } else if (el.getAttribute('placeholder')) {
        label = el.getAttribute('placeholder') ?? '';
      }
      const tag = el.tagName.toLowerCase();
      const type =
        tag === 'select'
          ? 'select'
          : tag === 'textarea'
            ? 'textarea'
            : el.getAttribute('type') || 'text';
      return { label: label.trim(), type };
    }),
  );

  const submitButtons = await page.locator('button, input[type="submit"]').evaluateAll((elements) =>
    elements
      .filter((el) => {
        const isButton = el.tagName.toLowerCase() === 'button';
        // A plain <button> inside a form defaults to type="submit" per the
        // HTML spec when no type attribute is given — checking the
        // *effective* type (falling back to "submit"), not just a literal
        // attribute match, so this works whether or not an app bothers to
        // write type="submit" explicitly.
        return isButton ? (el.getAttribute('type') || 'submit') === 'submit' : true;
      })
      .map((el) => {
        const withValue = el as unknown as { value?: string };
        return (el.textContent || withValue.value || el.getAttribute('aria-label') || '').trim();
      }),
  );

  const inputTypesByLabel: Record<string, string> = {};
  for (const { label, type } of fields) {
    if (label) inputTypesByLabel[label.toLowerCase()] = type;
  }

  return {
    inputTypesByLabel,
    submitLabels: submitButtons.filter(Boolean).map((label) => label.toLowerCase()),
  };
}

// Same generic, no-"dom"-lib evaluateAll pattern as collectFormFieldEvidence
// — resolved to a pathname in Node (not inside the browser callback) using
// the same `new URL(..., page.url())` idiom already used for `path` below.
async function collectLinkHrefs(page: Page): Promise<Record<string, string>> {
  const raw = await page.locator('a[href]').evaluateAll((anchors) =>
    anchors.map((a) => ({
      name: (a.textContent || a.getAttribute('aria-label') || '').trim(),
      href: a.getAttribute('href') || '',
    })),
  );
  const base = page.url();
  const hrefsByName: Record<string, string> = {};
  for (const { name, href } of raw) {
    if (!name || !href) continue;
    try {
      hrefsByName[name.toLowerCase()] = new URL(href, base).pathname;
    } catch {
      // mailto:, javascript:, or otherwise malformed — not a navigable page path
    }
  }
  return hrefsByName;
}

const CONFIRMATION_ROLES = ['alert', 'status', 'log'] as const;

// ARIA live regions are frequently empty in the initial DOM (their content
// is injected only after an action like a form submit), so they never show
// up via parseAriaSnapshot's role+name catalog below — a dedicated
// role-selector pass is the only way to see them at discovery time at all.
async function collectConfirmationRegions(page: Page): Promise<ConfirmationRegion[]> {
  const selector = CONFIRMATION_ROLES.map((role) => `[role="${role}"]`).join(', ');
  const roles = await page
    .locator(selector)
    .evaluateAll((elements) => elements.map((el) => el.getAttribute('role') || ''));

  const counts = new Map<string, number>();
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1);

  return CONFIRMATION_ROLES.filter((role) => counts.has(role)).map((role) => ({
    role,
    unique: counts.get(role) === 1,
  }));
}

/**
 * Maps a single already-navigated page: what's on it, categorized by ARIA
 * role, with every click/fill-shaped element re-verified through the
 * EXISTING LocatorResolver (not just read off the accessibility tree) so
 * the map only reports names that are proven to resolve uniquely right now.
 * Also captures generic DOM evidence (input `type`, native submit-control
 * status) the requirement-to-UI mapper uses to disambiguate candidates —
 * no app-specific selectors, just what any HTML form already exposes.
 */
export async function mapPage(page: Page): Promise<PageMap> {
  const [title, ariaSnapshot, testIds, formFieldEvidence, linkHrefsByName, confirmationRegions] =
    await Promise.all([
      page.title(),
      page.locator('body').ariaSnapshot(),
      page
        .locator('[data-testid]')
        .evaluateAll((elements) =>
          elements
            .map((el) => el.getAttribute('data-testid'))
            .filter((value): value is string => Boolean(value)),
        ),
      collectFormFieldEvidence(page),
      collectLinkHrefs(page),
      collectConfirmationRegions(page),
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

    const inputType = formFieldEvidence.inputTypesByLabel[name.toLowerCase()];

    if (role === 'heading') {
      headings.push(name);
    } else if (role === 'checkbox' || role === 'radio') {
      checkboxes.push({ role, name, verified: await verify(resolver, name, 'click') });
    } else if (role === 'link') {
      links.push({
        role,
        name,
        href: linkHrefsByName[name.toLowerCase()],
        verified: await verify(resolver, name, 'click'),
      });
    } else if (CLICK_ROLES.has(role)) {
      const isSubmit = formFieldEvidence.submitLabels.includes(name.toLowerCase());
      buttons.push({ role, name, isSubmit, verified: await verify(resolver, name, 'click') });
    } else if (FILL_ROLES.has(role)) {
      inputs.push({ role, name, inputType, verified: await verify(resolver, name, 'fill') });
    } else if (SELECT_ROLES.has(role)) {
      // Neither click nor fill fits a <select> — reported unverified, on purpose.
      selects.push({ role, name, inputType });
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
    confirmationRegions,
    ariaSnapshot,
  };
}
