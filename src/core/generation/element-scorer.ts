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
 * Generic name-similarity scoring shared by page and element matching —
 * exact match > every target word present > whole-word/phrase substring >
 * loose substring. No app-specific knowledge; works for any target/name
 * pair. Returns undefined (not a 0 score) when there's no match at all, so
 * callers can distinguish "no evidence" from "weak evidence".
 */
export function scoreNameMatch(target: string, candidateName: string): ScoreEvidence | undefined {
  const t = target.trim().toLowerCase();
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
