// Deterministic keyword/position extraction — same philosophy as
// url-extractor.ts/workflow-classifier.ts: no ML, no fuzzy matching. Only
// used as a FALLBACK once a request's text doesn't already name an
// application GAP has registered (see extractApplicationId in cli/gap.ts,
// which always tries the registry first) — this is what lets a brand-new
// application ("Discover Amazon at https://...", "Create automation for
// Salesforce at https://...") be named at all, without it, or any other
// application, ever being written into this file.
const NAME_PATTERN =
  /\b(?:discover|create automation for|generate automation for|map (?:this|the) application(?: at)?|explore (?:this|the) application(?: at)?|automate)\s+(.+?)(?=\s+(?:at\s+https?:\/\/|in\s+(?:qa|dev|staging|prod)\b)|[.,]|$)/i;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Pulls the application name out of phrasing like "Discover <Name> at
 * <url>" or "Create automation for <Name> at <url>. Requirement: ...".
 * Returns both the slug (a valid application id) and the raw display text
 * (used as the auto-registered application's `name` field) — undefined if
 * the text doesn't match any of the known request shapes, e.g. it named no
 * application at all and the caller should ask.
 */
export function extractApplicationName(text: string): { id: string; name: string } | undefined {
  const match = NAME_PATTERN.exec(text);
  const name = match?.[1]?.trim();
  if (!name) return undefined;
  const id = slugify(name);
  if (!id) return undefined;
  return { id, name };
}
