import { CoverageResult } from './coverage-types';

/** Human-readable report — the same data as CoverageResult, formatted for a terminal/attachment. */
export function formatTextReport(result: CoverageResult): string {
  const header = 'GAP TEST COVERAGE';
  const lines: string[] = [header, '='.repeat(header.length), ''];

  lines.push(`Requirement Coverage: ${result.coveragePercent}%`);
  lines.push(`Critical Requirement Coverage: ${result.criticalCoveragePercent}%`);
  if (result.featureCoverage.length > 0) {
    const avg =
      result.featureCoverage.reduce((sum, f) => sum + f.coveragePercent, 0) /
      result.featureCoverage.length;
    lines.push(
      `Feature Coverage (avg across ${result.featureCoverage.length} features): ${Math.round(avg * 10) / 10}%`,
    );
  }

  lines.push('');
  lines.push(`Total Requirements: ${result.totalRequirements}`);
  lines.push(`Covered: ${result.coveredRequirements}`);
  lines.push(`Uncovered: ${result.uncoveredRequirements.length}`);

  if (result.uncoveredRequirements.length > 0) {
    lines.push('');
    lines.push('Uncovered Requirements:');
    for (const id of result.uncoveredRequirements) lines.push(`- ${id}`);
  }

  lines.push('');
  lines.push(
    `Test-to-Requirement Mapping Rate: ${result.testMappingRatePercent}% ` +
      `(${result.testsMappedToRequirements}/${result.totalDiscoveredTests} discovered tests reference a requirement)`,
  );

  if (result.featureCoverage.length > 0) {
    lines.push('');
    lines.push('Feature Coverage Breakdown:');
    for (const f of result.featureCoverage) {
      lines.push(
        `- ${f.feature}: ${f.coveragePercent}% (${f.coveredRequirements}/${f.totalRequirements})`,
      );
    }
  }

  lines.push('');
  lines.push('NOTE: This is requirement coverage (are requirements automated at all),');
  lines.push('NOT execution pass rate (did the automated tests pass). See docs/COVERAGE.md.');

  return lines.join('\n');
}
