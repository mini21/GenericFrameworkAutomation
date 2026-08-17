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
