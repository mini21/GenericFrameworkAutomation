import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { parseIntent } from '../src/core/intent/intent-parser';
import { parseStructuredInput } from '../src/core/intent/structured-parser';
import { finalize, formatPlan } from '../src/core/intent/intent-resolver';
import { Ambiguity } from '../src/core/intent/intent-types';
import { classifyWorkflow } from '../src/core/intent/workflow-classifier';
import { extractUrl } from '../src/core/intent/url-extractor';
import { ENVIRONMENT_KEYWORDS, matchKeywords } from '../src/core/intent/vocabulary';
import { listApplications } from '../src/core/config/application-registry';
import {
  toPlaywrightArgs,
  toEnv,
  ResolvedExecution,
  CliOverrides,
} from '../src/core/execution/execution-resolver';
import { crawlApplication } from '../src/core/discovery/site-crawler';
import { writeApplicationMap, formatSummary } from '../src/core/discovery/application-map-writer';
import {
  runGenerationPipeline,
  approveGeneration,
  rejectGeneration,
} from '../src/core/generation/generation-orchestrator';
import { formatFinalSummary } from '../src/core/generation/presentation';
import { runCoverageReport } from '../src/core/generation/generated-test-validator';
import { createLineReader, prompt, LineReader } from './lib/line-reader';
import { readRequirementInteractively, decideApproval } from './lib/generation-approval';

const MAX_CLARIFICATION_ROUNDS = 5;

const STRUCTURED_FIELD_PATTERN =
  /^(application|app|environment|env|module|type|testtype|test type|browser|browsers|tag|tags)\s*:/i;

function isStructuredLine(line: string): boolean {
  return STRUCTURED_FIELD_PATTERN.test(line.trim());
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

async function handleRun(readLine: LineReader, text: string, autoConfirm: boolean): Promise<void> {
  const resolved = await resolveAmbiguitiesNL(readLine, text);
  if (!resolved) return;

  const outcome = finalize(resolved);
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

async function handleStructured(inputLines: string[]): Promise<void> {
  const result = parseStructuredInput(inputLines);
  if (result.errors.length > 0) {
    process.stdout.write(`\nGAP:\n  ${result.errors.join('\n  ')}\n\n`);
    return;
  }

  const outcome = finalize(result.intent);
  if (!outcome.ok) {
    process.stdout.write(`\nGAP: ${outcome.message}\n\n`);
    return;
  }

  printPlan(outcome.resolved);
  runResolved(outcome.resolved);
}

function extractApplicationId(text: string): string | undefined {
  const registry = listApplications();
  const lower = text.toLowerCase();
  for (const [id, def] of Object.entries(registry)) {
    if (new RegExp(`\\b${id}\\b`, 'i').test(text) || lower.includes(def.name.toLowerCase())) {
      return id;
    }
  }
  return undefined;
}

async function handleDiscover(readLine: LineReader, text: string): Promise<void> {
  let application = extractApplicationId(text);
  if (!application) {
    application = ((await prompt(readLine, '\nApplication? ')) ?? '').trim();
  }
  if (!application) {
    process.stdout.write('GAP: No application given — cannot discover.\n\n');
    return;
  }

  let url = extractUrl(text);
  if (!url) {
    url = ((await prompt(readLine, 'Application URL? ')) ?? '').trim();
  }
  if (!url) {
    process.stdout.write('GAP: No URL given — cannot discover.\n\n');
    return;
  }

  process.stdout.write(`\nGAP: discovering "${application}" at ${url}...\n`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: url });
    const map = await crawlApplication(context, {
      application,
      baseUrl: url,
      startPath: '/',
      maxPages: 15,
    });
    const filePath = writeApplicationMap(map);
    process.stdout.write(`\n${formatSummary(map)}\n`);
    process.stdout.write(`GAP: application map written to ${filePath}\n\n`);
  } finally {
    await browser.close();
  }
}

async function handleGenerate(
  readLine: LineReader,
  text: string,
  autoConfirm: boolean,
): Promise<void> {
  let application = extractApplicationId(text);
  if (!application) {
    application = ((await prompt(readLine, '\nApplication? ')) ?? '').trim();
  }
  if (!application) {
    process.stdout.write('GAP: No application given — cannot generate automation.\n\n');
    return;
  }

  const envMatches = matchKeywords(text, ENVIRONMENT_KEYWORDS);
  let environment: string = envMatches.length === 1 ? envMatches[0] : '';
  if (!environment) {
    const answer = ((await prompt(readLine, 'Environment? [qa] ')) ?? '').trim();
    environment = answer || 'qa';
  }

  let url: string | undefined = extractUrl(text);
  if (url === undefined) {
    const answer = (
      (await prompt(readLine, 'Application URL? (blank to reuse the existing discovery map) ')) ??
      ''
    ).trim();
    url = answer || undefined;
  }

  const requirementMarker = /requirement:\s*/i.exec(text);
  let requirementText = requirementMarker
    ? text.slice(requirementMarker.index + requirementMarker[0].length).trim()
    : '';
  if (!requirementText) {
    requirementText = await readRequirementInteractively(readLine);
  }
  if (!requirementText.trim()) {
    process.stdout.write(
      'GAP: No requirement/scenario provided. GAP cannot generate automation without one.\n\n',
    );
    return;
  }

  process.stdout.write(`\nGAP: generating automation for "${application}"...\n`);
  const outcome = await runGenerationPipeline({ application, environment, url, requirementText });

  if (outcome.status === 'blocked') {
    process.stdout.write(`\nGAP: ${outcome.message}\n\n`);
    return;
  }

  const approved = await decideApproval(readLine, outcome, autoConfirm);
  if (!approved) {
    rejectGeneration(outcome);
    process.stdout.write('\nGAP: Rejected — nothing was saved.\n\n');
    return;
  }

  approveGeneration(outcome);
  process.stdout.write('\nGAP: updating requirement coverage...\n');
  const coverage = runCoverageReport(outcome.spec.application);
  const coverageLine = /Requirement Coverage:.*$/m.exec(coverage.output)?.[0];
  process.stdout.write(
    formatFinalSummary(outcome.spec, outcome.filePath, outcome.stableTestId, coverageLine),
  );
}

async function handleLine(
  readLine: LineReader,
  inputLines: string[],
  autoConfirm: boolean,
): Promise<void> {
  if (inputLines.length > 1 || isStructuredLine(inputLines[0])) {
    await handleStructured(inputLines);
    return;
  }

  const text = inputLines[0];
  const workflow = classifyWorkflow(text);
  if (workflow === 'GENERATE') {
    await handleGenerate(readLine, text, autoConfirm);
    return;
  }
  if (workflow === 'DISCOVER') {
    await handleDiscover(readLine, text);
    return;
  }
  await handleRun(readLine, text, autoConfirm);
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
  process.stdout.write('Describe what you want to run, discover, or generate — or type "exit".\n');
  process.stdout.write('Examples:\n');
  process.stdout.write('  Run smoke tests for Leave module in QA using Chrome\n');
  process.stdout.write('  Discover HRMS at http://localhost:4100\n');
  process.stdout.write(
    '  Create automation for HRMS at http://localhost:4100 in QA. Requirement: ...\n\n',
  );

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
