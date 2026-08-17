import { RawStep } from './generation-types';

export interface ParsedRequirement {
  requirementText: string;
  testNameHint: string;
  steps: RawStep[];
}

// Every value-bearing pattern requires an explicit "quoted" value — this is
// deliberate: a step like "select the right leave type" has no way to be
// resolved without guessing what "right" means, which the spec forbids.
// Sentences that don't match any pattern below are silently skipped, not
// force-fit into an action — see parseRequirement()'s final comment.
const LOGIN_PATTERN = /^log\s*in\s+as\s+(.+)$/i;
const NAVIGATE_PATTERN = /^(?:open|go to|navigate to)\s+(?:the\s+)?(.+)$/i;
const DATES_PATTERN = /^select\s+start\s+and\s+end\s+dates?$/i;
const FILL_QUOTED_PATTERN = /^(?:fill|enter|set)\s+(.+?)\s+(?:as|to|with)\s+"([^"]+)"$/i;
const SELECT_QUOTED_PATTERN = /^select\s+"([^"]+)"\s+(?:for|in|from)\s+(.+)$/i;
const SUBMIT_REQUEST_PATTERN = /^submit\s+the\s+request$/i;
const CLICK_PATTERN = /^(?:click|submit|press)\s+(?:the\s+)?(.+)$/i;
const VERIFY_PATTERN = /^(?:verify|check|confirm)\b.*?"([^"]+)"/i;

function splitSentences(text: string): string[] {
  return text
    .split(/\r?\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);
}

function deriveTestName(firstSentence: string): string {
  // "Employee should be able to apply leave" -> "employee can apply leave",
  // matching the existing hand-written naming convention (see
  // applications/hrms/tests/ui/leave.spec.ts).
  const shouldBeAble = /^(.+?)\s+should\s+be\s+able\s+to\s+(.+)$/i.exec(firstSentence);
  if (shouldBeAble) {
    return `${shouldBeAble[1].toLowerCase()} can ${shouldBeAble[2].toLowerCase()}`;
  }
  return firstSentence.toLowerCase();
}

/**
 * Deterministic requirement/scenario text -> RawStep[] parser — no LLM, no
 * fuzzy matching, same philosophy as the Phase 1 intent parser
 * (src/core/intent/intent-parser.ts). Splits on sentence boundaries; each
 * sentence is checked against a fixed set of explicit patterns. A sentence
 * matching none of them is dropped, not guessed at — callers should treat
 * zero recognized steps as "ask the user to restate with explicit steps",
 * never as "there's nothing to test here."
 */
export function parseRequirement(text: string): ParsedRequirement {
  const sentences = splitSentences(text);
  const steps: RawStep[] = [];

  for (const sentence of sentences) {
    let match: RegExpExecArray | null;

    if (DATES_PATTERN.test(sentence)) {
      steps.push({ action: 'fill', target: 'Start Date', value: '{{date:start}}', raw: sentence });
      steps.push({ action: 'fill', target: 'End Date', value: '{{date:end}}', raw: sentence });
    } else if ((match = LOGIN_PATTERN.exec(sentence))) {
      steps.push({ action: 'login', target: match[1].trim(), raw: sentence });
    } else if ((match = FILL_QUOTED_PATTERN.exec(sentence))) {
      steps.push({ action: 'fill', target: match[1].trim(), value: match[2], raw: sentence });
    } else if ((match = SELECT_QUOTED_PATTERN.exec(sentence))) {
      steps.push({ action: 'fill', target: match[2].trim(), value: match[1], raw: sentence });
    } else if (SUBMIT_REQUEST_PATTERN.test(sentence)) {
      steps.push({ action: 'click', target: 'submit', raw: sentence });
    } else if ((match = VERIFY_PATTERN.exec(sentence))) {
      steps.push({ action: 'verify', value: match[1], raw: sentence });
    } else if ((match = NAVIGATE_PATTERN.exec(sentence))) {
      steps.push({ action: 'navigate', target: match[1].trim(), raw: sentence });
    } else if ((match = CLICK_PATTERN.exec(sentence))) {
      steps.push({ action: 'click', target: match[1].trim(), raw: sentence });
    }
    // else: not a recognized step shape — dropped, never force-mapped.
  }

  return {
    requirementText: text.trim(),
    testNameHint: deriveTestName(sentences[0] ?? text.trim()),
    steps,
  };
}
