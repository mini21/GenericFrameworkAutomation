import { GenerationOutcome } from '../../src/core/generation/generation-orchestrator';
import { formatApprovalScreen } from '../../src/core/generation/presentation';
import { LineReader, prompt } from './line-reader';

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
