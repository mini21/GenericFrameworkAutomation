export type Workflow = 'RUN' | 'DISCOVER' | 'GENERATE';

// Checked in this order — GENERATE and DISCOVER keywords are specific
// enough not to collide with ordinary RUN phrasing ("run smoke tests..."
// never matches either), so RUN stays the untouched default for every
// request that isn't explicitly asking to generate or discover.
const GENERATE_PATTERNS = [
  /\bcreate automation\b/i,
  /\bgenerate automation\b/i,
  /\bgenerate (?:a )?test\b/i,
  /\bautomate\b/i,
];
const DISCOVER_PATTERNS = [
  /\bdiscover\b/i,
  /\bmap (?:this|the) application\b/i,
  /\bexplore (?:this|the) application\b/i,
];

/** Deterministic keyword classification — no LLM, same philosophy as the rest of the intent layer. */
export function classifyWorkflow(text: string): Workflow {
  if (GENERATE_PATTERNS.some((pattern) => pattern.test(text))) return 'GENERATE';
  if (DISCOVER_PATTERNS.some((pattern) => pattern.test(text))) return 'DISCOVER';
  return 'RUN';
}
