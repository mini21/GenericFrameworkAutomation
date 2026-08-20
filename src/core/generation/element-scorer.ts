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

export interface ConfidenceThresholds {
  /** Minimum top score AND minimum margin over the runner-up for a clear, decisive winner. */
  highMinScore: number;
  highMinMargin: number;
  /**
   * Minimum top score AND minimum margin over the runner-up to STILL
   * auto-select — weaker evidence than HIGH, but a real, sufficient lead
   * over the next-best candidate. Below this, the top candidate is not
   * safely actionable (either too weak on its own, or too close to its
   * runner-up to tell apart) and resolution fails safely instead of
   * guessing — see ui-mapper.ts's finalizeElement/finalizeNavigate.
   */
  mediumMinScore: number;
  mediumMinMargin: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Named, per-call-configurable thresholds for the deterministic
 * auto-selection policy — never a magic number scattered inline. Read fresh
 * on every call (not cached at module load) so an env override takes effect
 * for any caller/test that sets it before invoking classifyConfidence,
 * without needing a process restart. Defaults match this scorer's
 * long-standing HIGH tier; MEDIUM's own minimum margin (previously implicit
 * — ANY topScore >= 20 was MEDIUM, regardless of how close the runner-up
 * was) is new: see the auto-locator-selection product requirement this
 * closes — MEDIUM must still mean "the top candidate genuinely, if less
 * decisively, beat the field", not "there's a tie nobody broke".
 */
export function currentConfidenceThresholds(): ConfidenceThresholds {
  return {
    highMinScore: envNumber('GAP_CONFIDENCE_HIGH_MIN_SCORE', 60),
    highMinMargin: envNumber('GAP_CONFIDENCE_HIGH_MIN_MARGIN', 30),
    mediumMinScore: envNumber('GAP_CONFIDENCE_MEDIUM_MIN_SCORE', 20),
    mediumMinMargin: envNumber('GAP_CONFIDENCE_MEDIUM_MIN_MARGIN', 10),
  };
}

/**
 * Turns a ranked candidate list into a confidence tier, purely from the top
 * candidate's own score and its MARGIN over the runner-up (score alone is
 * never enough — two decent-but-tied candidates must never auto-select):
 * - HIGH: a clear winner — strong absolute evidence AND a healthy margin.
 * - MEDIUM: real evidence, less decisive, but still a sufficient lead over
 *   the runner-up — still auto-selected (see ui-mapper.ts), never merely
 *   because MEDIUM was reached, always because the margin says so.
 * - LOW: nothing worth acting on — either too weak, or too close a race to
 *   call — report inability to map, never guess (see the "fail safely"
 *   product requirement this implements).
 */
export function classifyConfidence(
  topScore: number,
  secondScore: number,
  thresholds: ConfidenceThresholds = currentConfidenceThresholds(),
): Confidence {
  const margin = topScore - secondScore;
  if (topScore >= thresholds.highMinScore && margin >= thresholds.highMinMargin) return 'HIGH';
  if (topScore >= thresholds.mediumMinScore && margin >= thresholds.mediumMinMargin)
    return 'MEDIUM';
  return 'LOW';
}

/** Sorts candidates by score descending — ties broken by original order (stable). */
export function rankCandidates<T>(candidates: ScoredCandidate<T>[]): ScoredCandidate<T>[] {
  return [...candidates].sort((a, b) => b.score - a.score);
}
