import {
  CoverageResult,
  DiscoveredTest,
  FeatureCoverage,
  RequirementCoverage,
  RequirementsMap,
} from './coverage-types';

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function calculateFeatureCoverage(requirementCoverage: RequirementCoverage[]): FeatureCoverage[] {
  const byFeature = new Map<string, RequirementCoverage[]>();
  for (const r of requirementCoverage) {
    if (!r.feature) continue;
    const list = byFeature.get(r.feature) ?? [];
    list.push(r);
    byFeature.set(r.feature, list);
  }

  return Array.from(byFeature.entries()).map(([feature, reqs]) => {
    const covered = reqs.filter((r) => r.covered).length;
    return {
      feature,
      totalRequirements: reqs.length,
      coveredRequirements: covered,
      coveragePercent: percent(covered, reqs.length),
    };
  });
}

/**
 * Requirement-to-test traceability, NOT pass-rate-as-coverage. A
 * requirement is "covered" when at least one of its declared stable test
 * IDs is found among the discovered tests' tags — regardless of whether
 * that test passed or failed. Pass/fail is a separate concern (see
 * SummaryReporter), never conflated with this number.
 */
export function calculateCoverage(
  requirements: RequirementsMap,
  discoveredTests: DiscoveredTest[],
): CoverageResult {
  const discoveredTagSet = new Set<string>();
  for (const t of discoveredTests) {
    for (const tag of t.tags) discoveredTagSet.add(tag);
  }

  const requirementCoverage: RequirementCoverage[] = Object.entries(requirements).map(
    ([id, req]) => {
      const automatedTests = req.tests.filter((testId) => discoveredTagSet.has(testId));
      return {
        id,
        name: req.name,
        priority: req.priority,
        feature: req.feature,
        declaredTests: req.tests,
        automatedTests,
        covered: automatedTests.length > 0,
      };
    },
  );

  const totalRequirements = requirementCoverage.length;
  const coveredRequirements = requirementCoverage.filter((r) => r.covered).length;
  const uncoveredRequirements = requirementCoverage.filter((r) => !r.covered).map((r) => r.id);

  const criticalReqs = requirementCoverage.filter((r) => r.priority === 'Critical');
  const criticalCovered = criticalReqs.filter((r) => r.covered).length;

  const allDeclaredTestIds = new Set<string>();
  for (const req of Object.values(requirements)) {
    for (const t of req.tests) allDeclaredTestIds.add(t);
  }
  const testsMappedToRequirements = discoveredTests.filter((t) =>
    t.tags.some((tag) => allDeclaredTestIds.has(tag)),
  ).length;

  return {
    generatedAt: new Date().toISOString(),

    totalRequirements,
    coveredRequirements,
    uncoveredRequirements,
    coveragePercent: percent(coveredRequirements, totalRequirements),

    criticalTotal: criticalReqs.length,
    criticalCovered,
    criticalCoveragePercent: percent(criticalCovered, criticalReqs.length),

    featureCoverage: calculateFeatureCoverage(requirementCoverage),

    totalDiscoveredTests: discoveredTests.length,
    testsMappedToRequirements,
    testMappingRatePercent: percent(testsMappedToRequirements, discoveredTests.length),

    requirements: requirementCoverage,
  };
}
