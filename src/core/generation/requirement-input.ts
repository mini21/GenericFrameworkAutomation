/**
 * The Requirement is business intent ("Verify that a user can search for a
 * product...") and Test Steps are the executable workflow ("Search for a
 * product.\nVerify search results are displayed.\n...") — two different
 * semantic roles, not one blob to concatenate and parse together.
 * Concatenating them used to feed the Requirement sentence through
 * parseRequirement() as sentence #1 — a sentence starting with "Verify"
 * matches BARE_VERIFY_PATTERN, so it became a real (bogus, contextless —
 * no page has been opened yet) verify step ahead of the actual workflow,
 * blocking generation outright. When Test Steps is filled in, ONLY it is
 * parsed; Requirement becomes pure description, saved verbatim via
 * GenerationInput.businessRequirement, never executed. When Test Steps is
 * left blank (the natural-language-only flow), falls back to parsing the
 * Requirement text itself — unchanged behavior for that case, since
 * there's nothing else to parse. Shared by both the web UI (server/ui/routes.ts,
 * whose form has separate Requirement/Test Steps fields) and the CLI
 * (cli/gap-generate.ts's --requirement/--steps flags) — the same bug shape
 * hits any caller that lets a human supply both.
 */
export function requirementInputFor(
  requirement: string,
  steps: string,
): { requirementText: string; businessRequirement?: string } {
  const stepLines = steps
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (stepLines.length > 0) {
    return { requirementText: stepLines.join('\n'), businessRequirement: requirement.trim() };
  }
  return { requirementText: requirement.trim() };
}
