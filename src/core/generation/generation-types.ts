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

interface ResolvedStep {
  kind: 'login-helper' | 'login-inline' | 'navigate' | 'click' | 'fill' | 'verify';
  description: string;
  /** Present when this step resolved to a specific discovered element re-verified via LocatorResolver. */
  strategy?: LocatorStrategy;
  confidence?: Confidence;
  resolvedLocator?: string;
  /** Path to navigate to (`navigate`), or the fill/verify value to use verbatim or as a `{{date:*}}` marker (see code-generator.ts). */
  detail?: string;
}

export interface StepMapping {
  step: RawStep;
  /** Present only when confidently mapped — the honest "don't invent" contract lives in the absence of this field. */
  resolved?: ResolvedStep;
  /** Present when the step could NOT be confidently mapped. */
  unmapped?: { reason: string };
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
