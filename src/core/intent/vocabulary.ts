import { Environment } from '../../../config/env.config';
import { TestType } from '../execution/execution-manifest';
import { BrowserName } from '../config/application-registry';

/**
 * Fixed vocabulary the deterministic parsers match against — no LLM, no
 * fuzzy matching. Shared between the natural-language and structured-input
 * parsers so both accept exactly the same words for the same field.
 */
export const ENVIRONMENT_KEYWORDS: Record<Environment, string[]> = {
  dev: ['dev', 'development'],
  qa: ['qa', 'quality assurance'],
  staging: ['staging', 'stage'],
  prod: ['prod', 'production'],
};

export const TEST_TYPE_KEYWORDS: Record<TestType, string[]> = {
  smoke: ['smoke'],
  regression: ['regression'],
  sanity: ['sanity'],
  functional: ['functional'],
};

/** Maps a spoken/typed browser word to the Playwright project name that runs it. */
export const BROWSER_KEYWORDS: Record<string, BrowserName> = {
  chrome: 'chromium',
  chromium: 'chromium',
  firefox: 'firefox',
  safari: 'webkit',
  webkit: 'webkit',
};

export const ALL_BROWSERS_PHRASES = ['all browsers', 'every browser', 'all three browsers'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word/whole-phrase, case-insensitive match against free text. */
export function textContainsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text);
}

/** Every key in `table` that has at least one keyword present in `text`. */
export function matchKeywords<K extends string>(text: string, table: Record<K, string[]>): K[] {
  const matches: K[] = [];
  for (const key of Object.keys(table) as K[]) {
    if (table[key].some((keyword) => textContainsWord(text, keyword))) {
      matches.push(key);
    }
  }
  return matches;
}

/** Exact (not substring) case-insensitive match of a single declared value against a keyword table — used for structured input, where the field is already labeled. */
export function findByKeyword<K extends string>(
  value: string,
  table: Record<K, string[]>,
): K | undefined {
  const lower = value.trim().toLowerCase();
  return (Object.keys(table) as K[]).find((key) =>
    table[key].some((keyword) => keyword.toLowerCase() === lower),
  );
}
