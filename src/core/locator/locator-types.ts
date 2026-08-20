export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type LocatorStrategy =
  'primary' | 'role' | 'label' | 'placeholder' | 'text' | 'testid' | 'css' | 'xpath';

/** Confidence assigned per strategy when it yields exactly one usable match. */
export const STRATEGY_CONFIDENCE: Record<LocatorStrategy, Confidence> = {
  primary: 'HIGH',
  role: 'HIGH',
  label: 'HIGH',
  testid: 'HIGH',
  placeholder: 'MEDIUM',
  text: 'MEDIUM',
  css: 'MEDIUM',
  xpath: 'LOW',
};

export interface LocatorIntent {
  /** Human-readable name used for semantic matching (role/label/placeholder/text/testId). */
  name: string;
  /**
   * Optional explicit primary locator, tried before the semantic chain.
   * If it fails (not found or not unique), the chain runs as healing.
   */
  primary?: { testId?: string; css?: string; xpath?: string };
  /** Optional explicit CSS/XPath appended to the end of the semantic chain. */
  fallback?: { css?: string; xpath?: string };
  /**
   * Restricts the ENTIRE resolution chain (primary + role/label/placeholder/
   * text/testId/css/xpath) to descendants of the Nth `<form>` on the page —
   * the generic fix for two forms that legitimately share an identically-
   * named control (e.g. two "Submit" buttons, one per form): resolving by
   * name alone is genuinely ambiguous there, but scoping to "the form a
   * human confirmed" resolves it deterministically. A purely generic DOM
   * concept (form position), never form-specific naming/business logic —
   * see page-crawler.ts's collectFormContext for how `formIndex` is
   * discovered.
   */
  scope?: { formIndex: number };
}

export interface LocatorResolution {
  testName: string;
  timestamp: string;
  /** Human-readable description of the primary locator, if one was specified. */
  originalLocator?: string;
  /** Human-readable description of the locator that actually matched. */
  resolvedLocator: string;
  strategy: LocatorStrategy;
  confidence: Confidence;
  /** True when a primary locator was specified and failed, and the chain found the match instead. */
  healed: boolean;
}

export class LocatorResolutionError extends Error {
  constructor(
    message: string,
    public readonly intent: LocatorIntent,
    public readonly attempts: string[],
  ) {
    super(message);
    this.name = 'LocatorResolutionError';
  }
}
