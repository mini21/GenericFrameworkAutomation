import { Confidence } from '../locator/locator-types';

export interface ScoreEvidence {
  score: number;
  reason: string;
}

export interface ScoredCandidate<T> {
  item: T;
  score: number;
  reasons: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generic English words that describe a widget's SHAPE/CONTAINER, not its
 * label — "the search box", "email field", "reason input", "login button",
 * "settings page" all mean the accessible name is expected to be just the
 * leading word(s); the word itself never appears in a real accessible name
 * (nobody names a control "Search box"). The step's own ACTION (fill vs
 * click) and the discovered element's ROLE already narrow the candidate
 * pool to the right widget *kind* — these words are trailing noise on top
 * of that, not part of what to match. Universal English UI vocabulary, not
 * tied to any one field/app/domain, so stripping them helps ANY requirement
 * phrased the way a human actually talks about a form ("the X box/field")
 * rather than by its exact accessible name.
 */
const GENERIC_WIDGET_WORDS = new Set([
  'box',
  'field',
  'input',
  'control',
  'bar',
  'button',
  'link',
  'icon',
  'widget',
  'element',
  'page',
  'form',
  'screen',
  'menu',
  'dropdown',
]);

/**
 * Strips a trailing generic widget word (see GENERIC_WIDGET_WORDS) — only
 * ever the LAST word, and only when at least one word remains, so a
 * genuinely single-word target/name ("Box", "Submit") is never touched and
 * "email box" always still leaves "email" to match against.
 */
function stripTrailingWidgetWord(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  while (words.length > 1 && GENERIC_WIDGET_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(' ');
}

/**
 * Generic name-similarity scoring shared by page and element matching —
 * exact match > every target word present > whole-word/phrase substring >
 * loose substring. No app-specific knowledge; works for any target/name
 * pair. Returns undefined (not a 0 score) when there's no match at all, so
 * callers can distinguish "no evidence" from "weak evidence". The target
 * (never the discovered name — that's real DOM data, not to be second-
 * guessed) has trailing generic widget words stripped first, e.g. "the
 * search box" -> "the search" -> (below) "search".
 */
export function scoreNameMatch(target: string, candidateName: string): ScoreEvidence | undefined {
  const t = stripTrailingWidgetWord(target.trim().toLowerCase());
  const c = candidateName.trim().toLowerCase();
  if (!t || !c) return undefined;

  if (t === c) {
    return { score: 100, reason: `exact name match ("${candidateName}")` };
  }

  const targetWords = t.split(/\s+/).filter(Boolean);
  const candidateWords = c.split(/\s+/).filter(Boolean);
  if (targetWords.length > 1 && targetWords.every((w) => candidateWords.includes(w))) {
    return { score: 60, reason: `every word of "${target}" appears in "${candidateName}"` };
  }

  if (new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(c)) {
    return {
      score: 45,
      reason: `"${target}" appears as a whole word/phrase in "${candidateName}"`,
    };
  }

  if (c.includes(t)) {
    return { score: 20, reason: `"${target}" is a substring of "${candidateName}"` };
  }

  return undefined;
}

/**
 * Turns a ranked candidate list into a confidence tier:
 * - HIGH: a clear winner — strong absolute evidence AND a healthy margin
 *   over the runner-up (so a tie between two decent matches is never HIGH).
 * - MEDIUM: real evidence exists, but not decisively — ask a human.
 * - LOW: nothing worth acting on — report inability to map, never guess.
 */
export function classifyConfidence(topScore: number, secondScore: number): Confidence {
  if (topScore >= 60 && topScore - secondScore >= 30) return 'HIGH';
  if (topScore >= 20) return 'MEDIUM';
  return 'LOW';
}

/** Sorts candidates by score descending — ties broken by original order (stable). */
export function rankCandidates<T>(candidates: ScoredCandidate<T>[]): ScoredCandidate<T>[] {
  return [...candidates].sort((a, b) => b.score - a.score);
}
