// Sentence punctuation that can end up glued to a URL when it's extracted
// from free-form natural language rather than typed on its own line, e.g.
// "...at http://localhost:4100. Requirement: ..." — the period belongs to
// the sentence, not the URL. Stripped only from the END of the match, so a
// URL whose real path legitimately ends in one of these is only affected
// if it's also followed by more sentence text (the common case here).
const TRAILING_SENTENCE_PUNCTUATION = /[.,)\]}]+$/;

/**
 * Finds the first http(s) URL in free-form text, strips incidental
 * trailing sentence punctuation, and validates the result with the
 * standard `URL` parser. Returns undefined if no URL-shaped substring is
 * found, or if what's left after stripping still isn't a valid URL —
 * callers should treat that the same as "no URL supplied" and ask.
 */
export function extractUrl(text: string): string | undefined {
  const match = /https?:\/\/\S+/i.exec(text);
  if (!match) return undefined;

  const candidate = match[0].replace(TRAILING_SENTENCE_PUNCTUATION, '');
  try {
    // Validate only — return the original (stripped) string as-is, not
    // the parser's normalized form, so a path/trailing-slash the caller
    // actually typed is never silently rewritten.
    new URL(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}
