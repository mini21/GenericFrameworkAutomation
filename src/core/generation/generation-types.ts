import { TestType } from '../execution/execution-manifest';
import { Confidence, LocatorStrategy } from '../locator/locator-types';

export type StepAction = 'login' | 'navigate' | 'fill' | 'click' | 'verify';

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
  kind: 'login-helper' | 'login-inline' | 'navigate' | 'click' | 'fill' | 'verify' | 'verify-api';
  description: string;
  /** Present when this step resolved to a specific discovered element re-verified via LocatorResolver. */
  strategy?: LocatorStrategy;
  confidence?: Confidence;
  resolvedLocator?: string;
  /** Path to navigate to (`navigate`), the fill/verify value (verbatim or a `{{date:*}}` marker), or the expected HTTP status code (`verify-api`) — see code-generator.ts. */
  detail?: string;
}

/** One scored candidate considered for a step — kept for BOTH the ambiguous-confirmation prompt and diagnostic mode, whether or not it was ultimately chosen. */
export interface MappingCandidate {
  /** Display name (page name, or element name) and, for elements, the exact value a disambiguation choice re-parses to. */
  label: string;
  value: string;
  score: number;
  reasons: string[];
  selected: boolean;
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
