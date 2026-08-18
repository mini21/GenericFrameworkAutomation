import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { getApplication } from '../config/application-registry';
import { crawlApplication } from '../discovery/site-crawler';
import { writeApplicationMap } from '../discovery/application-map-writer';
import { ApplicationMap } from '../discovery/discovery-types';
import { establishAuthenticatedStart, DiscoveryCredential } from '../discovery/authenticated-start';
import { loadDataProfile } from '../execution/data-profile';
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
import { MappingCandidate, RawStep, StepMapping, TestSpecification } from './generation-types';

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
  /**
   * Called once per MEDIUM-confidence step to let a human pick a candidate —
   * return the chosen candidate's `value` (re-parsed as the step's exact
   * target, deterministically resolving it to HIGH), or undefined to leave
   * it unresolved. Omit for non-interactive callers: any step still
   * ambiguous after this is reported as `blocked`, listing every candidate,
   * never guessed.
   */
  resolveAmbiguity?: (step: RawStep, candidates: MappingCandidate[]) => Promise<string | undefined>;
  /** When true, every outcome (blocked or ready-for-approval) carries the full per-step scoring trail — see presentation.ts's formatDiagnostics. */
  diagnose?: boolean;
}

export interface ValidationSummary {
  typecheck: { passed: boolean; output: string };
  lint: { passed: boolean; output: string };
  execution: { passed: boolean; output: string };
}

export type GenerationOutcome =
  | { status: 'blocked'; message: string; diagnostics?: StepMapping[] }
  | {
      status: 'ready-for-approval';
      spec: TestSpecification;
      filePath: string;
      stableTestId: string;
      validation: ValidationSummary;
      diagnostics?: StepMapping[];
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

/**
 * `--start-path` always wins when given explicitly. Otherwise, if the
 * supplied `--url` itself carries a path (e.g. `http://host/login.html`),
 * that path is what the caller meant to start crawling from — discarding
 * it and always crawling `/` is what caused Generate to hit a 404 on
 * apps with no root route, even though the user's URL pointed straight
 * at a real page. A bare-origin URL (no path) falls back to the same
 * generic `/` default `gap:discover` itself uses. Never app-specific.
 */
export function resolveStartPath(url: string, explicitStartPath: string | undefined): string {
  if (explicitStartPath) return explicitStartPath;
  const { pathname } = new URL(url);
  return pathname && pathname !== '/' ? pathname : '/';
}

/**
 * Looks up this application's own registered default data/auth profile
 * (`config/applications.json`'s `dataProfiles[0]`/`authProfiles[0]` —
 * generic per-application config, the same convention every onboarded
 * app already follows) and reads the matching credential out of its
 * existing `applications/<app>/data/<profile>.json` file — never a
 * literal credential in source. Returns undefined on any missing
 * piece: an application with no registered profiles simply doesn't get
 * authenticated discovery, it never crashes discovery over it.
 */
function resolveDiscoveryCredential(application: string): DiscoveryCredential | undefined {
  try {
    const app = getApplication(application);
    const dataProfileId = app.dataProfiles[0];
    const authProfileKey = app.authProfiles[0];
    if (!dataProfileId || !authProfileKey) return undefined;
    const profile = loadDataProfile<Record<string, { username?: string; password?: string }>>(
      application,
      dataProfileId,
    );
    const credential = profile[authProfileKey];
    if (!credential?.username || !credential?.password) return undefined;
    return { username: credential.username, password: credential.password };
  } catch {
    return undefined;
  }
}

/** Total buttons/inputs/links/selects/checkboxes discovered across every page — the generic, app-agnostic signal that a crawl actually found something usable. */
function totalElementCount(map: ApplicationMap): number {
  return map.pages.reduce(
    (sum, page) =>
      sum +
      page.buttons.length +
      page.inputs.length +
      page.links.length +
      page.selects.length +
      page.checkboxes.length,
    0,
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
      let startPath = resolveStartPath(input.url, input.startPath);

      // No pre-captured session? If this page turns out to genuinely be a
      // login form, and this application has a registered credential
      // profile, perform a real login and continue discovery from wherever
      // that lands — never a guessed URL, never skipping the login itself.
      if (!input.storageStatePath) {
        const credential = resolveDiscoveryCredential(input.application);
        if (credential) {
          const probePage = await context.newPage();
          try {
            await probePage.goto(new URL(startPath, input.url).toString(), {
              waitUntil: 'domcontentloaded',
            });
            const authenticatedPath = await establishAuthenticatedStart(probePage, credential);
            if (authenticatedPath) startPath = authenticatedPath;
          } finally {
            await probePage.close();
          }
        }
      }

      const map = await crawlApplication(context, {
        application: input.application,
        baseUrl: input.url,
        startPath,
        maxPages: input.maxPages ?? 15,
      });
      if (totalElementCount(map) === 0) {
        return {
          error:
            `Discovery found ${map.pages.length} page(s) but zero buttons/inputs/links/selects/checkboxes ` +
            `across all of them (e.g. "${map.pages[0]?.pageName}" at ${map.pages[0]?.path}) — this usually ` +
            'means the start path 404s or the app needs authentication. Not overwriting any existing map. ' +
            'Pass --start-path (e.g. /dashboard.html) and/or --storage-state for an authenticated crawl.',
        };
      }
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

  let mappings = mapRequirementToUI(input.application, map, parsed.steps);

  // MEDIUM confidence: real evidence exists for more than one candidate.
  // Never guessed — ask (if a resolver was given), and re-score with the
  // human's exact choice substituted in as the step's target. That choice
  // is one of the discovered names verbatim, so it re-scores as an exact
  // match (HIGH) — this is re-mapping, not a second resolution path.
  for (
    let attempt = 0;
    attempt < parsed.steps.length && mappings.some((m) => m.ambiguous);
    attempt++
  ) {
    if (!input.resolveAmbiguity) break;
    let choseSomething = false;
    for (const m of mappings) {
      if (!m.ambiguous) continue;
      const chosen = await input.resolveAmbiguity(m.step, m.ambiguous.candidates);
      if (chosen) {
        m.step.target = chosen; // same object reference as parsed.steps[i] — mapRequirementToUI pushes `step` by reference
        choseSomething = true;
      }
    }
    if (!choseSomething) break;
    mappings = mapRequirementToUI(input.application, map, parsed.steps);
  }

  const diagnostics = input.diagnose ? mappings : undefined;

  const stillAmbiguous = mappings.filter((m) => m.ambiguous);
  if (stillAmbiguous.length > 0) {
    const lines = stillAmbiguous.map((m) => {
      const options = (m.ambiguous?.candidates ?? [])
        .map((c, i) => `      ${i + 1}. "${c.label}" (score ${c.score}: ${c.reasons.join('; ')})`)
        .join('\n');
      return `  - "${m.step.raw}":\n${options}`;
    });
    return {
      status: 'blocked',
      message: `${stillAmbiguous.length} step(s) matched more than one discovered candidate and need a human choice — re-run interactively to confirm:\n${lines.join('\n')}`,
      diagnostics,
    };
  }

  const unmapped = mappings.filter((m) => m.unmapped);
  if (unmapped.length > 0) {
    const lines = unmapped.map((m) => `  - "${m.step.raw}": ${m.unmapped?.reason}`);
    return {
      status: 'blocked',
      message: `Unable to confidently map ${unmapped.length} step(s) to the discovered application:\n${lines.join('\n')}`,
      diagnostics,
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
    diagnostics,
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
