import * as fs from 'fs';
import * as path from 'path';
import { getApplication } from '../config/application-registry';
import { TestType } from '../execution/execution-manifest';
import { RequirementsFile } from '../coverage/coverage-types';
import { ParsedRequirement } from './requirement-parser';
import { StepMapping, TestSpecification } from './generation-types';

function requirementsPath(application: string): string {
  return path.resolve(
    process.cwd(),
    'applications',
    application,
    'requirements',
    'requirements.json',
  );
}

function loadRequirementsFile(application: string): RequirementsFile {
  const filePath = requirementsPath(application);
  if (!fs.existsSync(filePath)) return { requirements: {} };
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RequirementsFile;
}

/** Infers the module from the first successfully-mapped navigate step whose target names a registered module. */
function detectModule(application: string, mappings: StepMapping[]): string | undefined {
  const app = getApplication(application);
  for (const mapping of mappings) {
    if (mapping.step.action !== 'navigate' || !mapping.resolved) continue;
    const target = (mapping.step.target ?? '').toLowerCase();
    const found = app.modules.find((m) => target.includes(m.toLowerCase()));
    if (found) return found;
  }
  return undefined;
}

/** Continues the SAME id sequence already used in requirements.json (e.g. LEAVE-004 -> LEAVE-005) — no separate "generated" numbering scheme. */
function nextRequirementId(application: string, module: string): string {
  const { requirements } = loadRequirementsFile(application);
  const prefix = `${module.toUpperCase()}-`;
  const existingNumbers = Object.keys(requirements)
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter((n) => Number.isInteger(n));
  const next = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export interface BuildSpecOptions {
  application: string;
  module?: string;
  type?: TestType;
}

/**
 * Assembles the structured TestSpecification (section 5's JSON shape) from
 * the parsed requirement + its UI mappings. Throws only for a genuine
 * precondition failure (module undeterminable) — mapping failures per step
 * are carried in `steps[].unmapped`, not thrown, so the caller can show the
 * user a complete, honest picture rather than stopping at the first gap.
 */
export function buildTestSpecification(
  parsed: ParsedRequirement,
  mappings: StepMapping[],
  options: BuildSpecOptions,
): TestSpecification {
  const module = options.module ?? detectModule(options.application, mappings);
  if (!module) {
    throw new Error(
      'Could not determine which module this test belongs to. Pass --module explicitly, or include ' +
        `a navigate step whose target names one of "${options.application}"'s registered modules.`,
    );
  }

  const requirementId = nextRequirementId(options.application, module);
  const preconditions = mappings.some((m) => m.step.action === 'login')
    ? ['User is authenticated']
    : [];
  const expectedResults = mappings
    .filter((m) => m.step.action === 'verify' && Boolean(m.resolved))
    .map(
      (m) =>
        // A quoted expected text is precise, so it's used verbatim (unchanged
        // from before). A bare verify has no invented text to fall back to —
        // its own raw wording (never rewritten) is the honest description.
        m.step.value ?? m.step.raw.replace(/^(?:verify|check|confirm)\s+/i, '').replace(/\.$/, ''),
    );

  return {
    requirementId,
    requirementText: parsed.requirementText,
    testName: parsed.testNameHint,
    application: options.application,
    module,
    type: options.type ?? 'functional',
    preconditions,
    steps: mappings,
    expectedResults,
  };
}
