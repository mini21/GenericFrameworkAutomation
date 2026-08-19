import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { Requirement, RequirementsFile } from '../coverage/coverage-types';
import { TestSpecification } from './generation-types';

function requirementsPath(application: string): string {
  return path.resolve(
    process.cwd(),
    'applications',
    application,
    'requirements',
    'requirements.json',
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Adds the new requirement to the application's EXISTING requirements.json
 * — the same file the EXISTING coverage calculator already reads. No new
 * coverage/traceability system: `tests: [stableTestId]` is exactly the
 * mechanism `coverage-calculator.ts` already cross-references against
 * discovered test tags for every hand-written requirement.
 */
export function saveRequirement(spec: TestSpecification, stableTestId: string): void {
  const filePath = requirementsPath(spec.application);
  const file: RequirementsFile = fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RequirementsFile)
    : { requirements: {} };

  if (file.requirements[spec.requirementId]) {
    throw new Error(`Requirement "${spec.requirementId}" already exists in ${filePath}.`);
  }

  const requirement: Requirement = {
    name: spec.requirementText.split(/[.\n]/)[0].trim() || spec.testName,
    priority: 'Medium',
    feature: capitalize(spec.module),
    tests: [stableTestId],
  };

  file.requirements[spec.requirementId] = requirement;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  spawnSync('npx', ['prettier', '--write', filePath], { encoding: 'utf-8' }); // cosmetic only
}

export interface GeneratedTestSummary {
  requirementId: string;
  name: string;
  stableTestId: string;
}

/**
 * Existing generated tests for an application — sourced from the SAME
 * requirements.json the coverage calculator already reads, filtered to
 * entries whose test id matches the generated-test naming convention
 * (code-generator.ts's `${application}.${module}.generated.${index}`) —
 * never a hand-written test, which uses its own hand-picked id. Powers
 * the web UI's "run an existing generated test" action (server/ui/routes.ts)
 * — no separate index of generated tests is maintained anywhere else.
 */
export function listGeneratedTests(application: string): GeneratedTestSummary[] {
  const filePath = requirementsPath(application);
  if (!fs.existsSync(filePath)) return [];
  const file = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RequirementsFile;
  const results: GeneratedTestSummary[] = [];
  for (const [requirementId, requirement] of Object.entries(file.requirements)) {
    const stableTestId = requirement.tests.find((t) => /\.generated\.\d+$/.test(t));
    if (stableTestId) results.push({ requirementId, name: requirement.name, stableTestId });
  }
  return results;
}
