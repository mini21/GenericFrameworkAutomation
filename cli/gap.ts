import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { parseIntent } from '../src/core/intent/intent-parser';
import { parseStructuredInput } from '../src/core/intent/structured-parser';
import { finalize, formatPlan } from '../src/core/intent/intent-resolver';
import { Ambiguity } from '../src/core/intent/intent-types';
import {
  toPlaywrightArgs,
  toEnv,
  ResolvedExecution,
  CliOverrides,
} from '../src/core/execution/execution-resolver';

const MAX_CLARIFICATION_ROUNDS = 5;

const STRUCTURED_FIELD_PATTERN =
  /^(application|app|environment|env|module|type|testtype|test type|browser|browsers|tag|tags)\s*:/i;

function isStructuredLine(line: string): boolean {
  return STRUCTURED_FIELD_PATTERN.test(line.trim());
}

/**
 * Reads one line at a time from a single shared async iterator over the
 * readline interface. Using `rl.question()` repeatedly (once per prompt) is
 * unsafe here: with piped/scripted input, readline can buffer and emit
 * lines faster than we re-attach each `question()` listener, silently
 * dropping any line that arrives while we're between prompts. Pulling from
 * one continuously-consumed iterator has no such race — it always returns
 * exactly the next line, however it arrived.
 */
type LineReader = () => Promise<string | null>;

function createLineReader(rl: readline.Interface): LineReader {
  const iterator = rl[Symbol.asyncIterator]();
  return async () => {
    const { value, done } = await iterator.next();
    return done ? null : value;
  };
}

async function prompt(readLine: LineReader, text: string): Promise<string | null> {
  process.stdout.write(text);
  return readLine();
}

function printAmbiguity(ambiguity: Ambiguity): void {
  process.stdout.write(`\n${ambiguity.question}\n`);
  ambiguity.options.forEach((opt, i) => process.stdout.write(`  ${i + 1}. ${opt.label}\n`));
}

/**
 * Re-parses the original text with each clarification answer appended as
 * its exact matched keyword — deterministic, and needs no extra state to
 * track "which field is this answer for": a chosen candidate's literal
 * id/keyword only ever matches itself once appended to the text.
 */
async function resolveAmbiguitiesNL(
  readLine: LineReader,
  originalText: string,
): Promise<Partial<CliOverrides> | null> {
  let answerText = '';
  let rounds = 0;

  for (;;) {
    const result = parseIntent(answerText ? `${originalText} ${answerText}` : originalText);
    if (result.ambiguities.length === 0) {
      return result.intent;
    }
    if (rounds >= MAX_CLARIFICATION_ROUNDS) {
      process.stdout.write(
        '\nGAP: Could not resolve this request after several clarifications. Please rephrase your request.\n\n',
      );
      return null;
    }

    const ambiguity = result.ambiguities[0];
    printAmbiguity(ambiguity);
    const answer = await prompt(readLine, '\nEnter a number: ');
    if (answer === null) return null;
    const chosen = ambiguity.options[Number(answer.trim()) - 1];
    if (!chosen) {
      process.stdout.write('GAP: Not a valid choice, please try again.\n');
      continue;
    }
    answerText = answerText ? `${answerText} ${chosen.value}` : chosen.value;
    rounds++;
  }
}

function printPlan(resolved: ResolvedExecution): void {
  process.stdout.write(`\nGAP interpreted your request as:\n\n${formatPlan(resolved)}\n`);
}

function runResolved(resolved: ResolvedExecution): void {
  const playwrightArgs = toPlaywrightArgs(resolved);
  const env = { ...process.env, ...toEnv(resolved) };

  process.stdout.write('\nExecuting...\n\n');
  const result = spawnSync('npx', ['playwright', ...playwrightArgs], { stdio: 'inherit', env });

  process.stdout.write('\nReport available at: reports/html-report/index.html\n');
  process.stdout.write('Run "npm run report:show" to open it.\n\n');

  if (result.status && result.status !== 0) {
    process.stdout.write(`GAP: Playwright exited with status ${result.status}.\n\n`);
  }
}

async function handleLine(
  readLine: LineReader,
  inputLines: string[],
  autoConfirm: boolean,
): Promise<void> {
  const structured = inputLines.length > 1 || isStructuredLine(inputLines[0]);

  let intent: Partial<CliOverrides>;
  if (structured) {
    const result = parseStructuredInput(inputLines);
    if (result.errors.length > 0) {
      process.stdout.write(`\nGAP:\n  ${result.errors.join('\n  ')}\n\n`);
      return;
    }
    intent = result.intent;
  } else {
    const resolved = await resolveAmbiguitiesNL(readLine, inputLines[0]);
    if (!resolved) return;
    intent = resolved;
  }

  const outcome = finalize(intent);
  if (!outcome.ok) {
    process.stdout.write(`\nGAP: ${outcome.message}\n\n`);
    return;
  }

  printPlan(outcome.resolved);

  if (!autoConfirm) {
    const answer = await prompt(readLine, '\nProceed? [Y/n] ');
    if (answer === null) return;
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'n' || normalized === 'no') {
      process.stdout.write('GAP: Cancelled.\n\n');
      return;
    }
  }

  runResolved(outcome.resolved);
}

async function promptLoop(readLine: LineReader, autoConfirm: boolean): Promise<void> {
  for (;;) {
    const raw = await prompt(readLine, 'GAP > ');
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;
    if (line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit') break;

    const inputLines = [line];
    if (isStructuredLine(line)) {
      for (;;) {
        const next = await prompt(readLine, '... ');
        if (next === null || !next.trim()) break;
        inputLines.push(next.trim());
      }
    }

    await handleLine(readLine, inputLines, autoConfirm);
  }
  process.stdout.write('\nGAP: Goodbye.\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const autoConfirm = argv.includes('--yes');
  const positional = argv
    .filter((a) => a !== '--yes')
    .join(' ')
    .trim();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const readLine = createLineReader(rl);

  process.stdout.write('GAP — Generic Automation Platform\n');
  process.stdout.write('Describe what you want to run in plain English, or type "exit".\n');
  process.stdout.write('Example: Run smoke tests for Leave module in QA using Chrome\n\n');

  if (positional) {
    await handleLine(readLine, [positional], autoConfirm);
    rl.close();
    return;
  }

  await promptLoop(readLine, autoConfirm);
  rl.close();
}

main().catch((error) => {
  process.stderr.write(`\nGAP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
