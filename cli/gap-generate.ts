import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import {
  runGenerationPipeline,
  approveGeneration,
  rejectGeneration,
} from '../src/core/generation/generation-orchestrator';
import { formatFinalSummary, formatDiagnostics } from '../src/core/generation/presentation';
import { runCoverageReport } from '../src/core/generation/generated-test-validator';
import { createLineReader } from './lib/line-reader';
import {
  readRequirementInteractively,
  decideApproval,
  resolveAmbiguityInteractively,
  resolveMissingValueInteractively,
} from './lib/generation-approval';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      application: { type: 'string' },
      environment: { type: 'string' },
      url: { type: 'string' },
      'storage-state': { type: 'string' },
      'start-path': { type: 'string' },
      requirement: { type: 'string' },
      'requirement-file': { type: 'string' },
      module: { type: 'string' },
      'max-pages': { type: 'string' },
      headless: { type: 'string' },
      approve: { type: 'boolean' },
      diagnose: { type: 'boolean' },
    },
    strict: true,
  });

  if (!values.application) {
    throw new Error(
      'Usage: npm run gap:generate -- --application=<id> [--environment=qa] [--url=<baseUrl>] ' +
        '[--storage-state=<path>] [--requirement="..."] [--requirement-file=<path>] [--module=<id>] [--approve]',
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const readLine = createLineReader(rl);

  let requirementText = values.requirement ?? '';
  if (!requirementText && values['requirement-file']) {
    requirementText = fs.readFileSync(values['requirement-file'], 'utf-8');
  }
  if (!requirementText) {
    requirementText = await readRequirementInteractively(readLine);
  }
  if (!requirementText.trim()) {
    throw new Error(
      'No requirement/scenario provided. GAP cannot generate automation without one.',
    );
  }

  process.stdout.write(`\nGAP: generating automation for "${values.application}"...\n`);

  const environment = values.environment ?? 'qa';
  const outcome = await runGenerationPipeline({
    application: values.application,
    environment,
    url: values.url,
    storageStatePath: values['storage-state'],
    startPath: values['start-path'],
    requirementText,
    module: values.module,
    maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
    headless: values.headless !== 'false',
    resolveAmbiguity: resolveAmbiguityInteractively(readLine),
    resolveMissingValue: resolveMissingValueInteractively(readLine),
    diagnose: Boolean(values.diagnose),
  });

  if (outcome.diagnostics) {
    process.stdout.write(formatDiagnostics(outcome.diagnostics));
  }

  if (outcome.status === 'blocked') {
    process.stdout.write(`\nGAP: ${outcome.message}\n\n`);
    rl.close();
    process.exitCode = 1;
    return;
  }

  const approved = await decideApproval(readLine, outcome, Boolean(values.approve));
  if (!approved) {
    rejectGeneration(outcome);
    process.stdout.write('\nGAP: Rejected — nothing was saved.\n\n');
    rl.close();
    return;
  }

  approveGeneration(outcome);

  process.stdout.write('\nGAP: updating requirement coverage...\n');
  const coverage = runCoverageReport(outcome.spec.application);
  const coverageLine = /Requirement Coverage:.*$/m.exec(coverage.output)?.[0];

  process.stdout.write(
    formatFinalSummary(
      outcome.spec,
      outcome.filePath,
      outcome.stableTestId,
      environment,
      coverageLine,
    ),
  );
  rl.close();
}

main().catch((error) => {
  process.stderr.write(`\nGAP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
