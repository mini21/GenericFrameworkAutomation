import { CliOverrides } from '../execution/execution-resolver';

export type AmbiguityField = 'application' | 'environment' | 'module' | 'type';

export interface AmbiguityOption {
  /** What the user sees in the numbered list. */
  label: string;
  /** The exact keyword to feed back into the parser to resolve this field unambiguously. */
  value: string;
}

export interface Ambiguity {
  field: AmbiguityField;
  question: string;
  options: AmbiguityOption[];
}

export interface ParseResult {
  intent: Partial<CliOverrides>;
  ambiguities: Ambiguity[];
}
