import { GenerationOutcome } from '../../src/core/generation/generation-orchestrator';
import { formatApprovalScreen } from '../../src/core/generation/presentation';
import { MappingCandidate, RawStep } from '../../src/core/generation/generation-types';
import { LineReader, prompt } from './line-reader';

/**
 * Section-12's MEDIUM-confidence "show candidate(s) and ask for
 * confirmation" — shared by both GAP entry points. The chosen candidate's
 * `value` is fed back into `runGenerationPipeline` as the step's exact
 * target, so it deterministically re-scores as an exact-name match; nothing
 * is guessed if the user leaves it blank.
 */
export function resolveAmbiguityInteractively(
  readLine: LineReader,
): (step: RawStep, candidates: MappingCandidate[]) => Promise<string | undefined> {
  return async (step, candidates) => {
    process.stdout.write(
      `\nGAP: "${step.raw}" matches more than one discovered candidate — which did you mean?\n`,
    );
    candidates.forEach((c, i) => {
      process.stdout.write(`  ${i + 1}. ${c.label} (score ${c.score})\n`);
      c.reasons.forEach((r) => process.stdout.write(`       - ${r}\n`));
    });
    const answer = ((await prompt(readLine, '  Choice (blank to skip): ')) ?? '').trim();
    const index = Number(answer) - 1;
    return Number.isInteger(index) && candidates[index] ? candidates[index].value : undefined;
  };
}

/**
 * A step named a field but stated no value ("Enter reason") — there's no
 * safe default for free-form business text, so ask instead of guessing or
 * only discovering it's missing 10+ seconds later via a submit that never
 * fires. A blank answer leaves it genuinely unresolved (reported clearly,
 * never silently filled with an empty string).
 */
export function resolveMissingValueInteractively(
  readLine: LineReader,
): (field: string, raw: string) => Promise<string | undefined> {
  return async (field, raw) => {
    process.stdout.write(`\nGAP: "${raw}" doesn't say what value to use.\n`);
    const answer = (
      (await prompt(readLine, `  What should "${field}" be filled with? `)) ?? ''
    ).trim();
    return answer || undefined;
  };
}

/** Multi-line "one step per line, blank line to finish" collection — shared by cli/gap-generate.ts and cli/gap.ts's GENERATE flow. */
export async function readRequirementInteractively(readLine: LineReader): Promise<string> {
  process.stdout.write(
    '\nDescribe the requirement/scenario (one step per line, e.g. "Login as employee.", ' +
      '"Open <Page>.", \'Fill <Field> as "value".\'). Finish with a blank line:\n',
  );
  const lines: string[] = [];
  for (;;) {
    const line = await prompt(readLine, '> ');
    if (line === null || !line.trim()) break;
    lines.push(line.trim());
  }
  return lines.join('\n');
}

/**
 * The section-12 approval screen + [A]pprove/[E]dit/[R]eject loop —
 * identical behavior from either GAP entry point (flags-based
 * `gap-generate.ts` or the natural-language `gap.ts` GENERATE flow), since
 * both call this instead of each implementing their own.
 */
export async function decideApproval(
  readLine: LineReader,
  outcome: Extract<GenerationOutcome, { status: 'ready-for-approval' }>,
  autoApprove: boolean,
): Promise<boolean> {
  process.stdout.write(formatApprovalScreen(outcome.spec, outcome.filePath, outcome.validation));
  process.stdout.write('\n');

  if (autoApprove) {
    process.stdout.write('GAP: --approve set — auto-approving (shown above, not silent).\n');
    return true;
  }

  for (;;) {
    const answer = (await prompt(readLine, '\n[A]pprove / [E]dit / [R]eject: ')) ?? 'r';
    const choice = answer.trim().toLowerCase();
    if (choice === 'a' || choice === 'approve') return true;
    if (choice === 'r' || choice === 'reject' || choice === '') return false;
    if (choice === 'e' || choice === 'edit') {
      process.stdout.write(
        `\nGAP: Edit the file now: ${outcome.filePath}\n` +
          'It has already passed typecheck/lint/execution as generated — re-validate manually after editing ' +
          `(npx tsc --noEmit && npx eslint <file> && npm run gap:test -- --application=${outcome.spec.application} ` +
          '--environment=qa) before approving.\n',
      );
      continue;
    }
    process.stdout.write('GAP: Please answer A, E, or R.\n');
  }
}
