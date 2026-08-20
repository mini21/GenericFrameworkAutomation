import { Confidence, LocatorStrategy } from '../locator/locator-types';

/**
 * One element the crawler found and categorized by ARIA role. `verified`
 * is only present for click/fill-shaped roles (button/link/checkbox/
 * textbox/...) — it means the EXISTING LocatorResolver was actually run
 * against the live page and confirmed this name resolves to a unique,
 * usable element, not just that it appeared in the accessibility tree.
 */
export interface DiscoveredElement {
  role: string;
  name: string;
  /** The underlying HTML `type` attribute (e.g. "date", "email", "text") — generic DOM evidence for disambiguating same-shaped fields, captured for inputs/textareas/selects only. */
  inputType?: string;
  /** True for a `<button type="submit">`/`<input type="submit">` — a generic, app-agnostic signal for "this is the form's primary action", independent of its label text. */
  isSubmit?: boolean;
  /** For `role: "link"` only — the link's `href`, resolved to a pathname (e.g. "/apply-leave.html"). Real navigation evidence: which page this element actually goes to, as opposed to text that merely mentions a page's name. */
  href?: string;
  /**
   * The nearest enclosing <form>'s own generic identity — its aria-label,
   * <legend>, name attribute, or nearest preceding heading, in that order —
   * captured ONLY when a page has more than one form (see page-crawler.ts's
   * collectFormLabels). A page with zero or one form never sets this: form
   * identity is only meaningful evidence once there's more than one form to
   * distinguish between. Never a guessed/invented label — absent when a
   * multi-form page's own form genuinely carries none of those signals.
   */
  formLabel?: string;
  /** Which `<form>` (0-based, document order) this element lives in — set alongside `formLabel`, and the value a resolved step's runtime locator scopes to (see LocatorIntent.scope). */
  formIndex?: number;
  verified?: {
    strategy: LocatorStrategy;
    confidence: Confidence;
    resolvedLocator: string;
  };
}

/**
 * An ARIA live-region landmark (`role="alert"`/`"status"`/`"log"`) —
 * the generic, app-agnostic W3C signal for "this is where the app
 * announces a transient result/confirmation to the user", independent of
 * any specific wording. Captured even when empty at discovery time
 * (its content typically only appears after an action like a form
 * submit), which is why it's a distinct DOM-structural fact rather than
 * a `DiscoveredElement` — those require a non-empty accessible name.
 */
export interface ConfirmationRegion {
  role: 'alert' | 'status' | 'log';
  /** True only when exactly one element with this role exists on the page — the safety gate before ever generating an assertion against it. */
  unique: boolean;
}

export interface PageMap {
  /** Pathname only (e.g. "/login.html"), used for crawl dedup and display. */
  path: string;
  url: string;
  title: string;
  /** Best-effort display name: title, else first heading, else path. */
  pageName: string;
  headings: string[];
  buttons: DiscoveredElement[];
  links: DiscoveredElement[];
  inputs: DiscoveredElement[];
  /** Combobox/listbox roles — not run through LocatorResolver (neither click nor fill fits a <select>). */
  selects: DiscoveredElement[];
  checkboxes: DiscoveredElement[];
  /**
   * Table/form/navigation landmarks are counted, not itemized — most are
   * unnamed in the accessibility tree, and itemizing rows/fields is future
   * scope. The actual named nav links still show up in `links` below.
   */
  tables: number;
  forms: number;
  navigation: number;
  /** Every distinct data-testid attribute present on the page at scan time, capped. */
  testIds: string[];
  /** ARIA live-region landmarks found on the page — see ConfirmationRegion. */
  confirmationRegions: ConfirmationRegion[];
  /** Raw Locator.ariaSnapshot() output for the page, kept for debugging/future use. */
  ariaSnapshot: string;
}

export interface ApplicationMap {
  application: string;
  baseUrl: string;
  generatedAt: string;
  pages: PageMap[];
  errors: { url: string; message: string }[];
}
