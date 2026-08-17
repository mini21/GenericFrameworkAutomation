import * as path from 'path';
import { TestSpecification } from './generation-types';
import { ValidationSummary } from './generation-orchestrator';

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath);
}

/** The section-12 approval screen — shared by cli/gap-generate.ts and cli/gap.ts's GENERATE flow so both show the exact same thing. */
export function formatApprovalScreen(
  spec: TestSpecification,
  filePath: string,
  validation: ValidationSummary,
): string {
  const lines: string[] = [
    '--------------------------------',
    'GENERATED AUTOMATION',
    '--------------------------------',
    '',
    'Requirement:',
    spec.requirementText,
    '',
    'Test:',
    spec.testName,
    '',
    'Files:',
    `- ${relativePath(filePath)}`,
    '',
    'Steps:',
  ];

  spec.steps.forEach((mapping, i) => {
    lines.push(`${i + 1}. ${mapping.step.raw} -> ${mapping.resolved?.description ?? '(unmapped)'}`);
  });

  lines.push('', 'Locator summary:');
  const withLocators = spec.steps.filter((m) => m.resolved?.strategy);
  if (withLocators.length === 0) {
    lines.push('  (no click/fill steps — nothing to resolve via LocatorResolver)');
  }
  for (const mapping of withLocators) {
    const r = mapping.resolved;
    if (!r) continue;
    lines.push(`  - ${r.detail}: ${r.strategy} (${r.confidence}) -> ${r.resolvedLocator}`);
  }

  const hasVerify = spec.steps.some((m) => m.step.action === 'verify' && m.resolved);
  lines.push(
    '',
    'Validation:',
    `${validation.typecheck.passed ? '✓' : '✗'} TypeScript`,
    `${validation.lint.passed ? '✓' : '✗'} Lint`,
    `${validation.execution.passed ? '✓' : '✗'} Test execution`,
    hasVerify
      ? `${validation.execution.passed ? '✓' : '✗'} Expected result`
      : '⚠ No verify step — this test does not assert an outcome',
    '--------------------------------',
  );

  return lines.join('\n');
}

export function formatFinalSummary(
  spec: TestSpecification,
  filePath: string,
  stableTestId: string,
  coverageSummary?: string,
): string {
  const lines = [
    '',
    'GAP: Saved.',
    '',
    `Application:    ${spec.application}`,
    `Module:         ${spec.module}`,
    `Requirement:    ${spec.requirementId} — ${spec.requirementText.split(/[.\n]/)[0].trim()}`,
    `Generated test: ${spec.testName}`,
    `Stable test id: @${stableTestId}`,
    `File:           ${relativePath(filePath)}`,
    `Requirements:   applications/${spec.application}/requirements/requirements.json`,
    '',
    'Report available at: reports/html-report/index.html',
    'Run "npm run report:show" to open it.',
  ];
  if (coverageSummary) {
    lines.push('', coverageSummary);
  }
  lines.push('');
  return lines.join('\n');
}
