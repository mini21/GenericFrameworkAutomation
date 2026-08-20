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
  action: 'click' | 'fill' | 'select',
  formIndex?: number,
): Promise<DiscoveredElement['verified']> {
  try {
    const { resolution } = await resolver.resolve(
      formIndex !== undefined ? { name, scope: { formIndex } } : { name },
      action,
    );
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

interface FormContext {
  /** Best-effort label per form, in document order (index = formIndex, matching `page.locator('form').nth(i)`). */
  labels: string[];
  /** `${role}::${name}` -> ordered list of formIndex values, one per real DOM occurrence inside a form. */
  occurrencesByKey: Record<string, number[]>;
}

const NO_FORM_CONTEXT: FormContext = { labels: [], occurrencesByKey: {} };

/**
 * Generic form-identity discovery — ONLY does anything when a page has 2+
 * forms; the single/no-form case (by far the common one) is completely
 * unaffected, short-circuiting on `NO_FORM_CONTEXT` before any of this
 * runs. A form's own label is its aria-label, else its <legend>, else its
 * `name` attribute, else the nearest heading appearing before it in the
 * document, else a positional fallback — generic HTML/ARIA authoring
 * signals, never app-specific vocabulary (see the module comment at the
 * top of this file re: no "if amazon"/"if hrms").
 *
 * `occurrencesByKey` records which form each button/input/select/link
 * genuinely lives in, in document order, so mapPage's own dedup below can
 * tell "the same control listed twice" apart from "two DIFFERENT controls
 * that happen to share a name" (e.g. an Employee form's "Submit" and a
 * Manager form's "Submit") — the concrete, generic fix for a Manual QA
 * otherwise being asked to pick between two visually identical candidates
 * with no way to tell them apart.
 */
async function collectFormContext(page: Page): Promise<FormContext> {
  const formCount = await page.locator('form').count();
  if (formCount < 2) return NO_FORM_CONTEXT;

  // A SINGLE flat, document-order query covering forms, their labeling
  // signals, headings, and every potential field tag — deliberately never
  // a nested `element.querySelectorAll(...)` (unlike `.closest()`/
  // `.querySelector()`, which already work fine elsewhere in this file,
  // `.querySelectorAll()`'s result loses its element typing under this
  // project's DOM-lib-free tsconfig). HTML forms can never nest, so a
  // running "which form am I inside" counter — incremented once per 'form'
  // tag encountered, in document order — is exact, not a heuristic.
  const flat = await page
    .locator('form, legend, h1, h2, h3, h4, h5, h6, button, a[href], input, select, textarea')
    .evaluateAll((elements) =>
      elements.map((el) => {
        const withExtras = el as unknown as {
          labels?: { textContent: string | null }[];
          value?: string;
          closest?: (selector: string) => unknown;
        };
        const tag = el.tagName.toLowerCase();
        const labelText = (withExtras.labels && withExtras.labels[0]?.textContent) || '';
        const insideForm = Boolean(withExtras.closest && withExtras.closest('form'));

        let role: string | undefined;
        let name = '';
        if (tag === 'button') {
          role = 'button';
          name = (el.textContent || withExtras.value || el.getAttribute('aria-label') || '').trim();
        } else if (tag === 'a') {
          role = 'link';
          name = (el.textContent || el.getAttribute('aria-label') || '').trim();
        } else if (tag === 'select') {
          role = 'combobox';
          name = (labelText || el.getAttribute('aria-label') || '').trim();
        } else if (tag === 'textarea') {
          role = 'textbox';
          name = (
            labelText ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            ''
          ).trim();
        } else if (tag === 'input') {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (type === 'submit' || type === 'button') {
            role = 'button';
            name = (
              withExtras.value ||
              el.getAttribute('aria-label') ||
              el.textContent ||
              ''
            ).trim();
          } else if (type === 'checkbox') {
            role = 'checkbox';
          } else if (type === 'radio') {
            role = 'radio';
          } else if (type !== 'hidden') {
            role = type === 'search' ? 'searchbox' : type === 'number' ? 'spinbutton' : 'textbox';
          }
          if (role === 'checkbox' || role === 'radio' || (role && !name)) {
            name = (
              labelText ||
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              ''
            ).trim();
          }
        }

        return {
          tag,
          text: (el.textContent || '').trim(),
          ariaLabel: (el.getAttribute('aria-label') || '').trim(),
          nameAttr: (el.getAttribute('name') || '').trim(),
          insideForm,
          field: role && name ? { role, name } : undefined,
        };
      }),
    );

  const labels: string[] = [];
  const occurrencesByKey: Record<string, number[]> = {};
  let currentFormIndex = -1;
  let currentFormAriaLabel = '';
  let currentFormName = '';
  let sawLegendForCurrentForm = false;
  let lastHeadingBeforeCurrentForm = '';
  let lastHeadingSeen = '';

  for (const el of flat) {
    if (el.tag === 'form') {
      currentFormIndex++;
      currentFormAriaLabel = el.ariaLabel;
      currentFormName = el.nameAttr;
      sawLegendForCurrentForm = false;
      lastHeadingBeforeCurrentForm = lastHeadingSeen;
      labels.push(''); // placeholder, filled in once this form's own signals are known (below)
      continue;
    }
    if (/^h[1-6]$/.test(el.tag)) {
      lastHeadingSeen = el.text;
      continue;
    }
    if (el.tag === 'legend' && currentFormIndex >= 0 && !sawLegendForCurrentForm && el.text) {
      labels[currentFormIndex] = el.text;
      sawLegendForCurrentForm = true;
      continue;
    }
    if (!el.field || !el.insideForm || currentFormIndex < 0) continue;
    const key = `${el.field.role}::${el.field.name}`;
    (occurrencesByKey[key] ||= []).push(currentFormIndex);
    if (!labels[currentFormIndex] && !sawLegendForCurrentForm) {
      labels[currentFormIndex] =
        currentFormAriaLabel ||
        currentFormName ||
        lastHeadingBeforeCurrentForm ||
        `Form ${currentFormIndex + 1}`;
    }
  }
  // A form with zero fields (or whose label was never resolved above)
  // still gets a positional fallback, never left blank.
  for (let i = 0; i <= currentFormIndex; i++) {
    if (!labels[i]) labels[i] = `Form ${i + 1}`;
  }

  return { labels, occurrencesByKey };
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
        // A plain <button> defaults to type="submit" per the HTML spec when
        // no type attribute is given — checking the *effective* type
        // (falling back to "submit"), not just a literal attribute match,
        // so this works whether or not an app bothers to write
        // type="submit" explicitly. That default only actually DOES
        // anything when the control is form-associated, though — a
        // <button> with no form ancestor (a menu toggle, "Back to top",
        // an "Add to cart" action wired up via JS, ...) is inert as a
        // submit control no matter its implicit type, so it must not be
        // treated as one; `.closest('form')` is a plain DOM fact, true for
        // any element in any form, on any application.
        const isEffectivelySubmit = isButton
          ? (el.getAttribute('type') || 'submit') === 'submit'
          : true;
        return isEffectivelySubmit && el.closest('form') !== null;
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
  const [
    title,
    ariaSnapshot,
    testIds,
    formFieldEvidence,
    linkHrefsByName,
    confirmationRegions,
    formContext,
  ] = await Promise.all([
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
    collectFormContext(page),
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

  // Tracks how many of each `${role}::${name}` key have been consumed so
  // far. Normally (0 or 1 real form occurrence for this key — the
  // overwhelming common case) this preserves the EXACT prior behavior: only
  // the first ariaSnapshot occurrence is ever recorded, name-deduped, no
  // form scoping applied. Only when `formContext.occurrencesByKey` proves a
  // key genuinely occurs in MORE THAN ONE form (e.g. two different forms
  // each with their own "Submit" button) does this individuate — one
  // DiscoveredElement per real DOM occurrence, each independently verified
  // against ITS OWN form via LocatorIntent.scope, so two same-named
  // controls in different forms stop collapsing into one and become two
  // genuinely distinct, genuinely resolvable candidates.
  const consumed = new Map<string, number>();
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
    const occurrences = formContext.occurrencesByKey[key];
    const seenCount = consumed.get(key) ?? 0;
    const multiForm = occurrences !== undefined && occurrences.length > 1;

    if (multiForm) {
      if (seenCount >= occurrences.length) continue;
    } else if (seenCount >= 1) {
      continue;
    }
    consumed.set(key, seenCount + 1);
    const formIndex = multiForm ? occurrences[seenCount] : undefined;
    const formLabel = formIndex !== undefined ? formContext.labels[formIndex] : undefined;

    const inputType = formFieldEvidence.inputTypesByLabel[name.toLowerCase()];

    if (role === 'heading') {
      headings.push(name);
    } else if (role === 'checkbox' || role === 'radio') {
      checkboxes.push({
        role,
        name,
        formIndex,
        formLabel,
        verified: await verify(resolver, name, 'click', formIndex),
      });
    } else if (role === 'link') {
      links.push({
        role,
        name,
        href: linkHrefsByName[name.toLowerCase()],
        formIndex,
        formLabel,
        verified: await verify(resolver, name, 'click', formIndex),
      });
    } else if (CLICK_ROLES.has(role)) {
      const isSubmit = formFieldEvidence.submitLabels.includes(name.toLowerCase());
      buttons.push({
        role,
        name,
        isSubmit,
        formIndex,
        formLabel,
        verified: await verify(resolver, name, 'click', formIndex),
      });
    } else if (FILL_ROLES.has(role)) {
      inputs.push({
        role,
        name,
        inputType,
        formIndex,
        formLabel,
        verified: await verify(resolver, name, 'fill', formIndex),
      });
    } else if (SELECT_ROLES.has(role)) {
      selects.push({
        role,
        name,
        inputType,
        formIndex,
        formLabel,
        verified: await verify(resolver, name, 'select', formIndex),
      });
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
