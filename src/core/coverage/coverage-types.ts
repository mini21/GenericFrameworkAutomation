export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Requirement {
  name: string;
  priority: Priority;
  /** Optional grouping used for feature-level coverage; omit if not tracked. */
  feature?: string;
  /** Stable test IDs (Playwright `tag` values, without the leading '@') that automate this requirement. */
  tests: string[];
}

export type RequirementsMap = Record<string, Requirement>;

export interface RequirementsFile {
  requirements: RequirementsMap;
}

/** A test as discovered from Playwright's own test list — not app-specific. */
export interface DiscoveredTest {
  title: string;
  tags: string[];
  file?: string;
}

export interface RequirementCoverage {
  id: string;
  name: string;
  priority: Priority;
  feature?: string;
  declaredTests: string[];
  automatedTests: string[];
  covered: boolean;
}

export interface FeatureCoverage {
  feature: string;
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
}

export interface CoverageResult {
  generatedAt: string;

  totalRequirements: number;
  coveredRequirements: number;
  uncoveredRequirements: string[];
  coveragePercent: number;

  criticalTotal: number;
  criticalCovered: number;
  criticalCoveragePercent: number;

  featureCoverage: FeatureCoverage[];

  /** Of all discovered tests, how many carry a tag referenced by at least one requirement. */
  totalDiscoveredTests: number;
  testsMappedToRequirements: number;
  testMappingRatePercent: number;

  requirements: RequirementCoverage[];
}
