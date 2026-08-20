import { TestType } from '../execution/execution-manifest';
import { Confidence, LocatorStrategy } from '../locator/locator-types';

export type StepAction = 'login' | 'navigate' | 'fill' | 'click' | 'select' | 'check' | 'verify';

/** One step as literally parsed from the requirement text, before UI mapping. */
export interface RawStep {
  action: StepAction;
  /** Field/button/page name referenced, e.g. "Leave", "Reason", "Submit Application". Absent for `login`/`verify`. */
  target?: string;
  /** Value to fill, or (for `login`) the profile role, or (for `verify`) the expected text. */
  value?: string;
  raw: string;
}

export interface ResolvedStep {
  /**
   * `verify` = a UI-observable oracle (text or a discovered ARIA live
   * region) — the default and only kind for a plain business/UI
   * requirement. `verify-api` is a DISTINCT, deliberately separate kind:
   * only produced when the requirement text explicitly asks for a network
   * outcome ("Verify API returns 201") — never auto-injected for a bare
   * "Verify confirmation", so a UI requirement's oracle always stays the
   * UI's own observable result, never an unrelated network status.
   */
  kind:
    | 'login-helper'
    | 'login-inline'
    | 'navigate'
    | 'click'
    | 'fill'
    | 'select'
    | 'check'
    | 'verify'
    | 'verify-api';
  description: string;
  /** Present when this step resolved to a specific discovered element re-verified via LocatorResolver. */
  strategy?: LocatorStrategy;
  confidence?: Confidence;
  resolvedLocator?: string;
  /** Path to navigate to (`navigate`), the fill/verify value (verbatim or a `{{date:*}}` marker), or the expected HTTP status code (`verify-api`) — see code-generator.ts. */
  detail?: string;
  /** Present only when this element lives in one of several forms on its page — see DiscoveredElement.formIndex. code-generator.ts emits a form-scoped LocatorIntent when set, instead of a plain name string. */
  formIndex?: number;
}

/** One scored candidate considered for a step — kept for BOTH the ambiguous-confirmation prompt and diagnostic mode, whether or not it was ultimately chosen. */
export interface MappingCandidate {
  /** Display name (page name, or element name) and, for elements, the exact value a disambiguation choice re-parses to. */
  label: string;
  value: string;
  score: number;
  reasons: string[];
  selected: boolean;
  /**
   * Present only for an element (fill/click) candidate — which discovered
   * page it actually lives on. Lets a human disambiguation prompt show
   * real structural context ("Page: X — URL: Y") instead of N visually
   * identical labels when several pages carry an identically-named
   * control (e.g. a site-wide header search icon) — see ui-mapper.ts.
   */
  pageName?: string;
  pageUrl?: string;
  /** Plain-English relationship to the page a PRECEDING step's own resolved element came from, e.g. "Same page as the previous step" — omitted when there's no preceding-step context to compare against. */
  relationship?: string;
  /** Qualitative read of `score`, for display without exposing the raw number's meaning. */
  matchConfidence?: 'High' | 'Medium' | 'Low';
  /** Plain-English element kind (e.g. "input", "button", "link") — present only for element (fill/click) candidates, so a Manual QA (or anyone reviewing an ambiguity card) can tell what's actually being offered without needing to know ARIA role vocabulary. */
  elementType?: string;
  /**
   * The nearest enclosing <form>'s own generic identity (aria-label, legend,
   * name attribute, or a preceding heading — see page-crawler.ts's
   * collectFormLabels), when this candidate's page has more than one form.
   * The concrete fix for "two forms on the same page with an identically
   * named Submit button": without this, both candidates render as visually
   * identical entries; with it, a disambiguation card can say "Employee
   * form" vs "Manager form" — a genuine business distinction — instead of
   * asking a Manual QA a technical locator question. Undefined whenever a
   * page has zero or one form, or the element isn't form-associated at all.
   */
  formLabel?: string;
}

export interface StepMapping {
  step: RawStep;
  /** HIGH/MEDIUM/LOW — mirrors which of resolved/ambiguous/unmapped is set below. Always present, even for step kinds (login/verify) that don't go through scoring. */
  confidence: Confidence;
  /** Present only when confidently (HIGH) mapped — the honest "don't invent" contract lives in the absence of this field. */
  resolved?: ResolvedStep;
  /** Present at MEDIUM confidence — real evidence exists for more than one candidate (or one candidate without a decisive margin); a human must pick. */
  ambiguous?: { candidates: MappingCandidate[] };
  /** Present at LOW confidence — could NOT be confidently mapped; never guessed. */
  unmapped?: { reason: string };
  /** Every candidate considered and scored (may be empty) — powers diagnostic mode regardless of confidence tier. */
  diagnostics: MappingCandidate[];
}

export interface TestSpecification {
  requirementId: string;
  requirementText: string;
  testName: string;
  application: string;
  module: string;
  type: TestType;
  preconditions: string[];
  steps: StepMapping[];
  expectedResults: string[];
}

export interface GenerationResult {
  spec: TestSpecification;
  code: string;
  filePath: string;
  /** Tag (no leading '@') referenced by requirements.json's `tests` array for this generated test. */
  stableTestId: string;
  fullyMapped: boolean;
}
