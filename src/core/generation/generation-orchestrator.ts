import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { getApplication } from '../config/application-registry';
import { crawlApplication } from '../discovery/site-crawler';
import { writeApplicationMap } from '../discovery/application-map-writer';
import { ApplicationMap } from '../discovery/discovery-types';
import { parseRequirement } from './requirement-parser';
import { mapRequirementToUI } from './ui-mapper';
import { buildTestSpecification } from './test-spec-builder';
import { generateSpecFile } from './code-generator';
import { writeGeneratedFile, deleteGeneratedFile } from './generation-writer';
import { saveRequirement } from './requirements-writer';
import {
  formatFile,
  typecheckProject,
  lintFile,
  runGeneratedTest,
} from './generated-test-validator';
import { TestSpecification } from './generation-types';

export interface GenerationInput {
  application: string;
  environment: string;
  /** When provided, discovery is (re)run fresh before generation — the map is always the source used, per spec. */
  url?: string;
  storageStatePath?: string;
  /** Where discovery starts crawling from when `url` is set — default '/', override for apps with no route at '/' (e.g. an authenticated app whose root 404s). */
  startPath?: string;
  requirementText: string;
  module?: string;
  maxPages?: number;
  headless?: boolean;
}

export interface ValidationSummary {
  typecheck: { passed: boolean; output: string };
  lint: { passed: boolean; output: string };
  execution: { passed: boolean; output: string };
}

export type GenerationOutcome =
  | { status: 'blocked'; message: string }
  | {
      status: 'ready-for-approval';
      spec: TestSpecification;
      filePath: string;
      stableTestId: string;
      validation: ValidationSummary;
    };

function mapPath(application: string): string {
  return path.resolve(
    process.cwd(),
    'applications',
    application,
    'discovery',
    'application-map.json',
  );
}

async function loadOrDiscoverMap(
  input: GenerationInput,
): Promise<ApplicationMap | { error: string }> {
  if (input.url) {
    const browser = await chromium.launch({ headless: input.headless ?? true });
    try {
      const context = await browser.newContext({
        baseURL: input.url,
        storageState: input.storageStatePath,
      });
      const map = await crawlApplication(context, {
        application: input.application,
        baseUrl: input.url,
        startPath: input.startPath ?? '/',
        maxPages: input.maxPages ?? 15,
      });
      writeApplicationMap(map);
      return map;
    } finally {
      await browser.close();
    }
  }

  const filePath = mapPath(input.application);
  if (!fs.existsSync(filePath)) {
    return {
      error:
        `No application map found for "${input.application}" at ${filePath}. ` +
        'Pass --url to discover it first, e.g. --url=http://localhost:4100.',
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ApplicationMap;
}

/**
 * The complete discover -> parse -> map -> generate -> validate pipeline.
 * Returns 'blocked' with a human-readable reason for ANY failure point —
 * missing application, missing map, zero derivable steps, an unmapped
 * step, or a failed typecheck/lint/execution — so every caller (the
 * flags-based CLI and the NL-guided REPL flow) can print the same message
 * uniformly instead of each re-implementing failure handling.
 *
 * On success the generated file is ALREADY on disk (needed for real
 * typecheck/lint/execution against it) but is not yet "saved" in the
 * product sense — callers MUST call `approveGeneration` or
 * `rejectGeneration` to finish the job; a rejected/never-decided file is
 * not left behind.
 */
export async function runGenerationPipeline(input: GenerationInput): Promise<GenerationOutcome> {
  try {
    getApplication(input.application);
  } catch (error) {
    return { status: 'blocked', message: error instanceof Error ? error.message : String(error) };
  }

  const map = await loadOrDiscoverMap(input);
  if ('error' in map) {
    return { status: 'blocked', message: map.error };
  }

  const parsed = parseRequirement(input.requirementText);
  if (parsed.steps.length === 0) {
    return {
      status: 'blocked',
      message:
        'Could not derive any concrete steps from the requirement. Describe explicit steps, e.g.:\n' +
        '  Login as employee.\n' +
        '  Open <Page Name>.\n' +
        '  Fill <Field Name> as "value".\n' +
        '  Submit the request.\n' +
        '  Verify "expected text" is shown.',
    };
  }

  const mappings = mapRequirementToUI(input.application, map, parsed.steps);
  const unmapped = mappings.filter((m) => m.unmapped);
  if (unmapped.length > 0) {
    const lines = unmapped.map((m) => `  - "${m.step.raw}": ${m.unmapped?.reason}`);
    return {
      status: 'blocked',
      message: `Unable to confidently map ${unmapped.length} step(s) to the discovered application:\n${lines.join('\n')}`,
    };
  }

  let spec: TestSpecification;
  try {
    spec = buildTestSpecification(parsed, mappings, {
      application: input.application,
      module: input.module,
    });
  } catch (error) {
    return { status: 'blocked', message: error instanceof Error ? error.message : String(error) };
  }

  const generated = generateSpecFile(spec);
  writeGeneratedFile(generated.filePath, generated.code);
  formatFile(generated.filePath); // cosmetic only — a failure here isn't fatal, typecheck/lint below are the real gates

  const typecheck = typecheckProject();
  if (!typecheck.passed) {
    deleteGeneratedFile(generated.filePath);
    return { status: 'blocked', message: `Generated code failed typecheck:\n${typecheck.output}` };
  }

  const lint = lintFile(generated.filePath);
  if (!lint.passed) {
    deleteGeneratedFile(generated.filePath);
    return { status: 'blocked', message: `Generated code failed lint:\n${lint.output}` };
  }

  const execution = runGeneratedTest(input.application, input.environment, generated.filePath);
  if (!execution.passed) {
    deleteGeneratedFile(generated.filePath);
    return {
      status: 'blocked',
      message: `Generated test did not pass execution — nothing was saved:\n${execution.output}`,
    };
  }

  return {
    status: 'ready-for-approval',
    spec,
    filePath: generated.filePath,
    stableTestId: generated.stableTestId,
    validation: { typecheck, lint, execution },
  };
}

/** Finishes the job after a human (or --approve) says yes: the file already exists, this wires it into requirement traceability. */
export function approveGeneration(
  outcome: Extract<GenerationOutcome, { status: 'ready-for-approval' }>,
): void {
  saveRequirement(outcome.spec, outcome.stableTestId);
}

/** Undoes generation entirely — no trace left of a rejected attempt. */
export function rejectGeneration(
  outcome: Extract<GenerationOutcome, { status: 'ready-for-approval' }>,
): void {
  deleteGeneratedFile(outcome.filePath);
}
