import { chromium } from 'playwright';
import {
  getApplication,
  hasApplication,
  ensureApplicationRegistered,
} from '../config/application-registry';
import { crawlApplication } from '../discovery/site-crawler';
import { readApplicationMap, writeApplicationMapSafely } from '../discovery/application-map-writer';
import { isMapUsable } from '../discovery/map-analysis';
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
  /**
   * The business-intent sentence, when a caller keeps it separate from the
   * executable workflow (e.g. the web UI's "Requirement" field, distinct
   * from its "Test Steps" field) — descriptive only, saved verbatim as
   * TestSpecification.requirementText for reporting, but NEVER parsed for
   * executable steps. Fixes the bug where a Requirement sentence like
   * "Verify that a user can search for a product..." got parsed as a real
   * (bogus, contextless) verify step ahead of the actual workflow, because
   * it happened to start with "Verify". Omit when there's only ever been
   * one combined text (every CLI caller) — requirementText itself is both
   * parsed AND used for display, exactly as before.
   */
  businessRequirement?: string;
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
  /**
   * Opts into the pre-margin-policy interactive fallback (see ui-mapper.ts's
   * MapRequirementOptions) — a step that can't be safely auto-selected is
   * offered to `resolveAmbiguity` above instead of failing safely. Default
   * false/omitted: normal automation NEVER prompts for a locator — the
   * product requirement this closes. Only an explicit debug/developer
   * caller (e.g. `gap:generate --interactive`) should ever set this.
   */
  interactiveResolution?: boolean;
  /**
   * Called once per field named without a value ("Enter reason") — return
   * the value to fill it with, or undefined to leave it unresolved. Omit
   * for non-interactive callers: any field still missing a value after
   * this is reported as `blocked`, listing every one, never guessed.
   */
  resolveMissingValue?: (field: string, raw: string) => Promise<string | undefined>;
  /** When true, every outcome (blocked or ready-for-approval) carries the full per-step scoring trail — see presentation.ts's formatDiagnostics. */
  diagnose?: boolean;
  /**
   * Optional, purely observational — fired at the pipeline's own existing
   * phase boundaries so a caller (e.g. the web UI's live progress timeline)
   * can reflect real progress instead of a guessed/fake one. Never
   * required, never changes what the pipeline does: the CLI simply doesn't
   * pass it, same as `resolveAmbiguity`/`resolveMissingValue` above.
   */
  onPhase?: (phase: GenerationPhase, detail?: string) => void;
}

export type GenerationPhase =
  'connecting' | 'discovering' | 'mapping' | 'understanding' | 'generating' | 'validating';

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

/**
 * `--start-path` always wins when given explicitly. Otherwise, if the
 * supplied `--url` itself carries a path (e.g. `http://host/login.html`),
 * that path is what the caller meant to start crawling from — discarding
 * it and always crawling `/` is what caused Generate to hit a 404 on
 * apps with no root route, even though the user's URL pointed straight
 * at a real page. A bare-origin URL (no path) falls back to this
 * application's own registered `startPath` (set once at onboarding —
 * `npm run gap:onboard -- ... --startPath=/dashboard.html` — so every
 * later call doesn't need to repeat it), and only then the generic `/`
 * default `gap:discover` itself uses. Never app-specific in this function.
 */
export function resolveStartPath(
  url: string,
  explicitStartPath: string | undefined,
  registeredStartPath?: string,
): string {
  if (explicitStartPath) return explicitStartPath;
  const { pathname } = new URL(url);
  if (pathname && pathname !== '/') return pathname;
  return registeredStartPath || '/';
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

/**
 * The SAME application data-profile file resolveDiscoveryCredential reads
 * above, generically typed for GAP's own test-data lookups (e.g. a
 * "Search for a product" step with no literal value — see ui-mapper.ts's
 * deriveValueFrom resolution) rather than credentials. An application
 * simply adds whatever entity-type keys it needs (e.g.
 * { "product": { "searchTerm": "wireless mouse" } }) to its own
 * applications/<app>/data/<profile>.json — never hardcoded per-application
 * in core. Returns undefined on any missing piece, same as above.
 */
function resolveTestDataProfile(
  application: string,
): Record<string, { searchTerm?: string } | undefined> | undefined {
  try {
    const app = getApplication(application);
    const dataProfileId = app.dataProfiles[0];
    if (!dataProfileId) return undefined;
    return loadDataProfile<Record<string, { searchTerm?: string } | undefined>>(
      application,
      dataProfileId,
    );
  } catch {
    return undefined;
  }
}

/**
 * A generic diagnosis for the one execution-failure shape that's genuinely
 * ambiguous to read cold: `page.waitForResponse` timing out on a captured
 * submit (see code-generator.ts's needsSubmitResponseCapture) means the
 * click never actually triggered a network request at all — the most
 * common reason, for ANY application's form, is the browser's own native
 * "required field" validation blocking the submit before it fires, because
 * a fill step's value was never specified (an unquoted step like "Enter
 * reason" is deliberately never guessed at — see requirement-parser.ts).
 * Every other execution failure already carries Playwright's own clear
 * error text, so this only adds a hint for this one specific pattern.
 */
export function explainExecutionFailure(output: string): string | undefined {
  if (output.includes('waitForResponse') && output.includes('Timeout')) {
    return (
      'Likely cause: the submit click never triggered a network request at all — the ' +
      'browser\'s own "please fill out this field" validation probably blocked it. Check ' +
      'that every required field mentioned in the requirement has an explicit, quoted value ' +
      '(e.g. Fill Reason as "Family trip"), not just a bare mention like "Enter reason".'
    );
  }
  return undefined;
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
      let startPath = resolveStartPath(
        input.url,
        input.startPath,
        getApplication(input.application).startPath,
      );

      // No pre-captured session? If this page turns out to genuinely be a
      // login form, and this application has a registered credential
      // profile, perform a real login and continue discovery from wherever
      // that lands — never a guessed URL, never skipping the login itself.
      let loginPage: ApplicationMap['pages'][number] | undefined;
      if (!input.storageStatePath) {
        const credential = resolveDiscoveryCredential(input.application);
        if (credential) {
          const probePage = await context.newPage();
          try {
            await probePage.goto(new URL(startPath, input.url).toString(), {
              waitUntil: 'domcontentloaded',
            });
            const authenticated = await establishAuthenticatedStart(probePage, credential);
            if (authenticated) {
              startPath = authenticated.path;
              loginPage = authenticated.loginPage;
            }
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

      // The BFS above resumes from the AUTHENTICATED start path — it never
      // revisits the login page itself (nothing in the authenticated area
      // typically links back to it), so without this a bare "Login as X"
      // step (ui-mapper.ts's mapLogin inline-login fallback) would find no
      // login-page-shaped entry in `map.pages` to resolve against for ANY
      // application that needs authenticated discovery and has no custom
      // fixtures/loginAsXxx helper of its own.
      if (loginPage && !map.pages.some((p) => p.path === loginPage!.path)) {
        map.pages.unshift(loginPage);
      }

      if (!isMapUsable(map)) {
        // A transient/blocked crawl (bot-check, interstitial, rate-limit,
        // an app that needs auth this run didn't have) must not be treated
        // as "this application is undiscovered" when a real map from an
        // earlier successful crawl already exists on disk — falling back
        // to it lets generation proceed on known-good data instead of
        // needlessly blocking every run until the target happens to be
        // reachable again. writeApplicationMapSafely never lets the empty
        // result overwrite that existing map either way.
        writeApplicationMapSafely(map);
        const existing = readApplicationMap(input.application);
        if (existing && isMapUsable(existing)) return existing;

        return {
          error:
            `Discovery found ${map.pages.length} page(s) but zero buttons/inputs/links/selects/checkboxes ` +
            `across all of them (e.g. "${map.pages[0]?.pageName}" at ${map.pages[0]?.path}) — this usually ` +
            'means the start path 404s, the app needs authentication, or a bot-check/interstitial page was ' +
            'served instead of the real application. No usable existing map to fall back on either. Pass ' +
            '--start-path (e.g. /dashboard.html) and/or --storage-state for an authenticated crawl.',
        };
      }

      writeApplicationMapSafely(map);
      return map;
    } finally {
      await browser.close();
    }
  }

  const existing = readApplicationMap(input.application);
  if (!existing) {
    return {
      error:
        `No application map found for "${input.application}". ` +
        'Pass --url to discover it first, e.g. --url=http://localhost:4100.',
    };
  }
  return existing;
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
/** The `baseUrl` an existing discovery map already recorded for this application, if any. */
function existingMapBaseUrl(application: string): string | undefined {
  return readApplicationMap(application)?.baseUrl || undefined;
}

/**
 * GAP has no fixed list of applications — any id is valid the moment
 * there's a URL to reach it at, exactly like discovery itself (see
 * cli/gap-discover.ts) already requires no prior registration. This makes
 * generation/execution work the same way: the FIRST time an application is
 * named, either `--url` on this call or an already-written discovery map
 * (crawled but never formally onboarded) is enough to derive a minimal
 * definition and register it — modules/authProfiles/dataProfiles start
 * empty and simply get filled in over time (an application that never
 * needs auth never needs an authProfile; a step that genuinely needs a
 * credential/data value GAP can't derive already asks for it via
 * `resolveMissingValue`/`resolveAmbiguity`, never invents one here).
 * Returns false only when NEITHER a URL nor an existing map is available —
 * genuinely nothing to derive a definition from.
 */
function autoRegisterIfMissing(
  application: string,
  url: string | undefined,
  explicitStartPath: string | undefined,
): boolean {
  if (hasApplication(application)) return true;
  const baseUrl = url ?? existingMapBaseUrl(application);
  if (!baseUrl) return false;
  // Registering the same start path discovery itself resolved (see
  // resolveStartPath above) — a first-time app with no `startPath` of its
  // own yet gets exactly the path its own --url/--start-path pointed at,
  // not a guessed one, so a generated test can navigate there before its
  // first step the same way an app onboarded via gap:onboard already can.
  const startPath = url ? resolveStartPath(url, explicitStartPath, undefined) : undefined;
  ensureApplicationRegistered(application, baseUrl, undefined, startPath);
  return true;
}

export async function runGenerationPipeline(input: GenerationInput): Promise<GenerationOutcome> {
  if (!autoRegisterIfMissing(input.application, input.url, input.startPath)) {
    return {
      status: 'blocked',
      message:
        `Unknown application "${input.application}" and no discovery map or --url to register it ` +
        `from. Pass --url=<baseUrl> to discover and register it in one step.`,
    };
  }

  input.onPhase?.(input.url ? 'connecting' : 'mapping');
  if (input.url) input.onPhase?.('discovering');
  const map = await loadOrDiscoverMap(input);
  if ('error' in map) {
    return { status: 'blocked', message: map.error };
  }
  input.onPhase?.('mapping', `${map.pages.length} page(s) discovered`);

  input.onPhase?.('understanding');
  let parsed = parseRequirement(input.requirementText);
  let requirementText = input.requirementText;

  // "Enter reason"/"Fill Reason" names a field but states no value — there's
  // no safe default for free-form business text, so ask (if a resolver was
  // given) instead of either guessing or only discovering it's missing 10+
  // seconds later via a submit that silently never fires. A human's answer
  // re-parses back in as a proper quoted `Fill <field> as "<value>"`, the
  // same "re-parse with the exact literal substituted" pattern used for
  // every other kind of ambiguity in this pipeline.
  for (
    let attempt = 0;
    attempt < parsed.needsClarification.length + 1 && parsed.needsClarification.length > 0;
    attempt++
  ) {
    if (!input.resolveMissingValue) break;
    let answeredAnything = false;
    for (const item of parsed.needsClarification) {
      const value = await input.resolveMissingValue(item.field, item.raw);
      if (value) {
        requirementText = requirementText.replace(item.raw, `Fill ${item.field} as "${value}"`);
        answeredAnything = true;
      }
    }
    if (!answeredAnything) break;
    parsed = parseRequirement(requirementText);
  }

  if (parsed.needsClarification.length > 0) {
    const lines = parsed.needsClarification.map(
      (c) => `  - "${c.raw}" — what value should "${c.field}" be filled with?`,
    );
    return {
      status: 'blocked',
      message:
        `${parsed.needsClarification.length} step(s) name a field but never state what value to ` +
        `fill it with — never guessed:\n${lines.join('\n')}\n` +
        `Rewrite with an explicit value, e.g. Fill Reason as "Family trip".`,
    };
  }

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

  const dataProfile = resolveTestDataProfile(input.application);
  let mappings = mapRequirementToUI(input.application, map, parsed.steps, {
    interactive: input.interactiveResolution,
    dataProfile,
  });

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
    mappings = mapRequirementToUI(input.application, map, parsed.steps, {
      interactive: input.interactiveResolution,
      dataProfile,
    });
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

  input.onPhase?.('generating');
  let spec: TestSpecification;
  try {
    spec = buildTestSpecification(parsed, mappings, {
      application: input.application,
      module: input.module,
      requirementOverride: input.businessRequirement,
    });
  } catch (error) {
    return { status: 'blocked', message: error instanceof Error ? error.message : String(error) };
  }

  const generated = generateSpecFile(spec);
  writeGeneratedFile(generated.filePath, generated.code);
  formatFile(generated.filePath); // cosmetic only — a failure here isn't fatal, typecheck/lint below are the real gates

  input.onPhase?.('validating');
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
    const hint = explainExecutionFailure(execution.output);
    return {
      status: 'blocked',
      message:
        `Generated test did not pass execution — nothing was saved:\n${execution.output}` +
        (hint ? `\n\n${hint}` : ''),
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
