import * as path from 'path';
import { StepMapping, TestSpecification } from './generation-types';
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

/**
 * `--diagnose` output — for every step, every candidate the scorer
 * considered and why (or why not) it was chosen, regardless of whether the
 * step ultimately resolved. Powers debugging mapping failures without
 * touching HRMS-specific code — every line comes straight from
 * StepMapping.diagnostics, which element-scorer.ts already populates
 * generically for any application.
 */
export function formatDiagnostics(mappings: StepMapping[]): string {
  const lines: string[] = [
    '',
    '-------------------------------',
    'DIAGNOSTIC MODE',
    '-------------------------------',
  ];

  mappings.forEach((mapping, i) => {
    lines.push('', `${i + 1}. ${mapping.step.raw}`, `   Confidence: ${mapping.confidence}`);

    if (mapping.diagnostics.length === 0) {
      lines.push(
        '   Candidates: (none scored — this step kind is not matched against the ApplicationMap)',
      );
    } else {
      lines.push('   Candidates:');
      for (const c of mapping.diagnostics) {
        const marker = c.selected ? '[selected]' : '[rejected]';
        lines.push(`     ${marker} "${c.label}" — score ${c.score}`);
        for (const reason of c.reasons) {
          lines.push(`         - ${reason}`);
        }
      }
    }

    if (mapping.resolved) {
      lines.push(`   Resolved: ${mapping.resolved.description}`);
      if (mapping.resolved.strategy) {
        lines.push(
          `   Locator: ${mapping.resolved.strategy} (${mapping.resolved.confidence}) -> ${mapping.resolved.resolvedLocator}`,
        );
      }
    } else if (mapping.ambiguous) {
      lines.push('   Resolved: (ambiguous — not automatically mapped)');
    } else if (mapping.unmapped) {
      lines.push(`   Resolved: (unmapped — ${mapping.unmapped.reason})`);
    }
  });

  lines.push('', '-------------------------------');
  return lines.join('\n');
}

export function formatFinalSummary(
  spec: TestSpecification,
  filePath: string,
  stableTestId: string,
  environment: string,
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
    // Every locator/login helper in a generated test relies on BASE_URL
    // being set for THIS application — exactly like every hand-written
    // test in the suite — which only the GAP execution engine guarantees.
    // Running the file directly via `npx playwright test` skips that and
    // fails confusingly far downstream (e.g. "Username not found"), so the
    // one supported way to re-run it is spelled out right here.
    'To re-run this test later, use the GAP execution engine (not `npx playwright test` directly):',
    `  npm run gap:test -- --application=${spec.application} --environment=${environment} --tags=@${stableTestId}`,
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
