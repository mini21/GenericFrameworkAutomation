import * as fs from 'fs';
import * as path from 'path';
import { getApplication } from '../config/application-registry';
import { TestSpecification, StepMapping } from './generation-types';

export interface GeneratedFile {
  filePath: string;
  code: string;
  stableTestId: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function relativeImport(fromDir: string, toPath: string): string {
  const rel = path.relative(fromDir, toPath).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Continues the same per-module counter requirements.json uses, applied to
 * the stable test-id namespace instead. Takes the highest existing index
 * and adds one — NOT a count of existing files — so deleting an earlier
 * generated file (e.g. during cleanup) never causes a later regeneration
 * to collide with a file that's still on disk.
 */
function nextGeneratedIndex(application: string, module: string): number {
  const dir = path.resolve(process.cwd(), 'applications', application, 'tests', 'ui', 'generated');
  if (!fs.existsSync(dir)) return 1;
  const prefix = `${module}-`;
  const pattern = new RegExp(`^${prefix}(\\d+)-`);
  const highest = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.spec.ts'))
    .map((f) => Number(pattern.exec(f)?.[1] ?? 0))
    .reduce((max, n) => Math.max(max, n), 0);
  return highest + 1;
}

/**
 * A resolved step's target, as the literal expression to pass to
 * ui.click/fill/selectOption/check. Plain `"Name"` in the overwhelming
 * common case; a `{ name, scope: { formIndex } }` object literal only when
 * this candidate came from one of several forms on its page (see
 * DiscoveredElement.formIndex / LocatorIntent.scope) — the runtime piece of
 * the fix for two forms sharing an identically-named control, matching
 * whatever a human's disambiguation choice (or an unambiguous unique
 * per-form match) actually resolved to.
 */
function targetExpression(name: string, formIndex: number | undefined): string {
  if (formIndex === undefined) return JSON.stringify(name);
  return `{ name: ${JSON.stringify(name)}, scope: { formIndex: ${formIndex} } }`;
}

function valueExpression(rawValue: string | undefined): string {
  if (rawValue === '{{date:start}}') return 'startDate';
  if (rawValue === '{{date:end}}') return 'endDate';
  return JSON.stringify(rawValue ?? '');
}

function usesDateMarkers(steps: StepMapping[]): boolean {
  return steps.some((s) => s.step.value === '{{date:start}}' || s.step.value === '{{date:end}}');
}

/** Whether this spec needs the `selectedEntityLocator`/`selectedEntityName` runtime variables — see the 'select-entity'/'open-entity' cases in stepLines below. */
function usesEntityTracking(steps: StepMapping[]): boolean {
  return steps.some((s) => s.resolved?.kind === 'select-entity');
}

/**
 * Only capture the submit action's HTTP response when there's exactly one
 * submit click AND an EXPLICIT `verify-api` step in the spec to consume it
 * — i.e. only when the requirement itself asked for a network outcome
 * ("Verify API returns 201"). A plain UI verify (`kind: 'verify'`, role- or
 * text-based) never triggers this: a UI business requirement's oracle is
 * the UI's own observable result, not an unrelated network status — see
 * ui-mapper.ts's mapVerify. Anything else (no verify-api, or more than one
 * submit) falls back to a plain click, so a `submitResponse` variable is
 * never declared and left unused (which would fail the generated file's
 * own lint step) and never redeclared (a real submit-then-submit flow).
 */
function needsSubmitResponseCapture(steps: StepMapping[]): boolean {
  const submitClicks = steps.filter(
    (s) => s.resolved?.kind === 'click' && s.step.target === 'submit',
  );
  const hasApiVerify = steps.some((s) => s.resolved?.kind === 'verify-api');
  return submitClicks.length === 1 && hasApiVerify;
}

function loginHelperDetail(
  step: StepMapping,
): { moduleName: string; functionName: string; profileKey: string } | undefined {
  if (step.resolved?.kind !== 'login-helper' || !step.resolved.detail) return undefined;
  return JSON.parse(step.resolved.detail) as {
    moduleName: string;
    functionName: string;
    profileKey: string;
  };
}

function loginInlineDetail(
  step: StepMapping,
):
  | { path: string; username: string; password: string; button: string; profileKey: string }
  | undefined {
  if (step.resolved?.kind !== 'login-inline' || !step.resolved.detail) return undefined;
  return JSON.parse(step.resolved.detail) as {
    path: string;
    username: string;
    password: string;
    button: string;
    profileKey: string;
  };
}

function stepLines(
  step: StepMapping,
  applicationStartPath: string | undefined,
  shouldCaptureSubmitResponse: boolean,
  submitResponseCaptured: boolean,
): string[] {
  const resolved = step.resolved;
  if (!resolved) {
    // Enforced by the caller (gap-generate.ts) never calling this generator
    // unless every step resolved — defensive only, should be unreachable.
    throw new Error(`Cannot generate code for an unmapped step: "${step.step.raw}"`);
  }

  switch (resolved.kind) {
    case 'login-helper': {
      const detail = loginHelperDetail(step);
      if (!detail) throw new Error('login-helper step missing detail');
      // Explicit, visible in the generated file, not implicit inside the
      // helper: establishes the application's own configured start page
      // BEFORE login runs — config/applications.json's per-application
      // `startPath`, never a literal path invented here. Omitted (not a
      // blank string) when an application hasn't registered one, so this
      // never generates a guessed navigation.
      const lines: string[] = [];
      if (applicationStartPath) {
        lines.push(`await page.goto(${JSON.stringify(applicationStartPath)});`);
      }
      lines.push(`await ${detail.functionName}(page, ui, profile.${detail.profileKey});`);
      return lines;
    }
    case 'login-inline': {
      const detail = loginInlineDetail(step);
      if (!detail) throw new Error('login-inline step missing detail');
      return [
        `await page.goto(${JSON.stringify(detail.path)});`,
        `await ui.fill(${JSON.stringify(detail.username)}, profile.${detail.profileKey}.username);`,
        `await ui.fill(${JSON.stringify(detail.password)}, profile.${detail.profileKey}.password);`,
        `const urlBeforeLogin = page.url();`,
        `await ui.click(${JSON.stringify(detail.button)});`,
        // A login form may submit via a real navigation, or via a
        // fetch()-then-redirect where the click itself returns before the
        // URL actually changes (a click-then-navigate race is exactly what
        // exposed this: without waiting here, the NEXT step's own
        // navigation can collide with an in-flight post-login redirect and
        // get aborted). Generic — waits for ANY URL change, never assumes
        // a specific destination path. Best-effort: an app whose login
        // genuinely never navigates (e.g. an in-place SPA update) must not
        // fail the whole test over this wait alone.
        `await page.waitForURL((url) => url.toString() !== urlBeforeLogin, { timeout: 10000 }).catch(() => {});`,
      ];
    }
    case 'navigate':
      return [`await page.goto(${JSON.stringify(resolved.detail ?? '')});`];
    case 'fill':
      return [
        `await ui.fill(${targetExpression(resolved.detail ?? '', resolved.formIndex)}, ${valueExpression(step.step.value)});`,
      ];
    case 'select':
      return [
        `await ui.selectOption(${targetExpression(resolved.detail ?? '', resolved.formIndex)}, ${valueExpression(step.step.value)});`,
      ];
    case 'check':
      return [`await ui.check(${targetExpression(resolved.detail ?? '', resolved.formIndex)});`];
    case 'select-entity':
      // Informational + the actual runtime capture: `resolved.detail` is
      // the entity-type noun (e.g. "product") — the REAL discovery (opt-in
      // data-entity markup, else a generic structural fallback — see
      // entity-discovery.ts's selectEntity) happens LIVE, against whatever
      // page is actually current at this point in the test, never a
      // discovery-time snapshot: a real results/listing page frequently
      // only exists after a live search/filter action. `.first()`-via-
      // selectEntity is a deliberate, DOCUMENT-ORDER pick among genuinely
      // distinct entity candidates (never "ambiguity suppression" — see
      // ui-mapper.ts's 'select-entity' resolution for why this is a
      // different, safe operation). The name is captured live, not baked
      // in at generation time (see mapVerify's `{{entity:selected}}`
      // marker below, which reads this same variable).
      return [
        `// ${resolved.description}`,
        `selectedEntityLocator = await selectEntity(page, ${JSON.stringify(resolved.detail ?? '')});`,
        `selectedEntityName = (await selectedEntityLocator.textContent())?.trim() ?? '';`,
      ];
    case 'open-entity':
      return [
        `const urlBeforeOpen = page.url();`,
        `await selectedEntityLocator.click();`,
        `await page.waitForURL((url) => url.toString() !== urlBeforeOpen, { timeout: 10000 }).catch(() => {});`,
      ];
    case 'deferred-navigate':
      // A `navigate` step with zero static page evidence, resolved live —
      // deliberately role-scoped to "link" (see ui-mapper.ts's
      // deferredElementResolution) rather than routed through
      // ui.click()'s full multi-role chain: navigation intent specifically
      // means "follow a link", not "press whatever same-substring-named
      // button also exists" (e.g. "Add to Cart" vs a bare "cart" target).
      // Playwright's own strict-locator mode still refuses a genuinely
      // ambiguous multi-link match.
      return [
        `const urlBeforeOpen = page.url();`,
        `await page.getByRole('link', { name: ${JSON.stringify(resolved.detail ?? '')} }).click();`,
        `await page.waitForURL((url) => url.toString() !== urlBeforeOpen, { timeout: 10000 }).catch(() => {});`,
      ];
    case 'click':
      if (step.step.target === 'submit' && shouldCaptureSubmitResponse) {
        // A submit control's own alert/status region often reports BOTH
        // success and failure through the same element (HRMS's single
        // #result-message role="alert" is a real example) — "some alert
        // became visible" alone can't tell those apart without guessing
        // the app's exact success wording. The submit action's own HTTP
        // response is a generic, non-guessed signal every form-via-fetch
        // app already provides; captured here so a later bare verify (see
        // below) can assert the operation actually succeeded, not just
        // that *a* message rendered.
        // Assigns the outer `let submitResponse` (declared once, before
        // any step — see generateSpecFile) rather than declaring its own
        // — this step and a later verify-api step now each run inside
        // their OWN test.step() callback (see liveStep in
        // src/core/execution/live-step.ts), so a `const` declared in one
        // callback's scope would not be visible from another.
        return [
          `const [response] = await Promise.all([`,
          `  page.waitForResponse((r) => r.request().method() !== 'GET'),`,
          `  ui.click(${targetExpression(resolved.detail ?? '', resolved.formIndex)}),`,
          `]);`,
          `submitResponse = response;`,
        ];
      }
      // A step whose resolved target follows the generic "Add to
      // <Container>" convention (see requirement-parser.ts's
      // ADD_TO_CONTAINER_PATTERN) commonly triggers an async fetch/XHR
      // with no visible DOM change ui.click() itself would ever wait for
      // — without waiting for the resulting network response, a
      // following step (e.g. "Open the cart", a genuine navigation) can
      // race ahead of the write it depends on and observe stale state.
      // Same Promise.all pattern as the submit-response capture above,
      // just discarding the response — this is purely a synchronization
      // fix, not something a later step consumes.
      if (/^add to /i.test(resolved.detail ?? '')) {
        return [
          `await Promise.all([`,
          `  page.waitForResponse((r) => r.request().method() !== 'GET'),`,
          `  ui.click(${targetExpression(resolved.detail ?? '', resolved.formIndex)}),`,
          `]);`,
        ];
      }
      return [`await ui.click(${targetExpression(resolved.detail ?? '', resolved.formIndex)});`];
    case 'verify': {
      // A UI business requirement's oracle is always the UI's own
      // observable result: a quoted expected text asserts by text; a bare
      // NOTIFICATION-type verify resolved against a discovered ARIA live
      // region (see ui-mapper.ts's mapVerify) asserts by role; a bare
      // CONTENT-type verify ("results"/"items"/"list" — a live region does
      // NOT reliably represent this) asserts that the preceding fill
      // step's own value appears somewhere on the page, via `strategy:
      // 'text'` with `.first()` (a real results page often repeats the
      // term). Neither ever depends on the submit's network response —
      // see needsSubmitResponseCapture and the 'verify-api' case below for
      // the one case that legitimately does. The step's own plain-English
      // wording is passed as the assertion's failure message so a failure
      // reads as "Verify that search results are displayed" first, with
      // the raw locator/timeout detail underneath — not the other way
      // around.
      const message = JSON.stringify(step.step.raw);
      if (resolved.strategy === 'role') {
        return [
          `await expect(page.getByRole(${JSON.stringify(resolved.detail ?? '')}), ${message}).toBeVisible();`,
        ];
      }
      if (resolved.strategy === 'text') {
        // `{{entity:selected}}` (same computed-value-marker convention as
        // {{date:start}}/{{api:NNN}}) means "assert against whatever a
        // preceding select-entity step ACTUALLY captured live", i.e. the
        // runtime `selectedEntityName` variable — never a string literal
        // baked in at generation time (see ui-mapper.ts's mapVerify).
        const textExpr =
          resolved.detail === '{{entity:selected}}'
            ? 'selectedEntityName'
            : JSON.stringify(resolved.detail ?? '');
        return [`await expect(page.getByText(${textExpr}).first(), ${message}).toBeVisible();`];
      }
      return [
        `await expect(page.getByText(${JSON.stringify(resolved.detail ?? '')}), ${message}).toBeVisible();`,
      ];
    }
    case 'verify-api': {
      // Only reachable when the requirement explicitly asked for a network
      // outcome ("Verify API returns 201") — see requirement-parser.ts's
      // API_STATUS_PATTERN and needsSubmitResponseCapture above.
      if (!submitResponseCaptured) {
        throw new Error(
          'A verify-api step needs a preceding submit action whose response was captured, ' +
            'but none was found in this spec.',
        );
      }
      return [`expect(submitResponse.status()).toBe(${resolved.detail});`];
    }
    default:
      throw new Error(`Unknown resolved step kind: ${String((resolved as { kind: string }).kind)}`);
  }
}

/**
 * Turns a fully-mapped TestSpecification into a real `.spec.ts` — same
 * fixtures, same tag conventions, same ui.click/ui.fill API every
 * hand-written spec in the framework already uses. Every caller must have
 * already verified `spec.steps.every(s => s.resolved)` — see
 * cli/gap-generate.ts; this function does not invent an action for a step
 * it wasn't given a resolution for.
 */
export function generateSpecFile(spec: TestSpecification): GeneratedFile {
  const app = getApplication(spec.application);
  const outputDir = path.resolve(
    process.cwd(),
    'applications',
    spec.application,
    'tests',
    'ui',
    'generated',
  );
  const slug = slugify(spec.testName);
  const index = nextGeneratedIndex(spec.application, spec.module);
  const fileName = `${spec.module}-${String(index).padStart(2, '0')}-${slug}.spec.ts`;
  const filePath = path.join(outputDir, fileName);

  const baseFixtureImport = relativeImport(
    outputDir,
    path.resolve(process.cwd(), 'src', 'core', 'fixtures', 'base.fixture'),
  );
  const constantsImport = relativeImport(
    outputDir,
    path.resolve(process.cwd(), 'src', 'core', 'constants'),
  );
  const dataProfileImport = relativeImport(
    outputDir,
    path.resolve(process.cwd(), 'src', 'core', 'execution', 'data-profile'),
  );
  const executionContextImport = relativeImport(
    outputDir,
    path.resolve(process.cwd(), 'src', 'core', 'execution', 'execution-context'),
  );
  const liveStepImport = relativeImport(
    outputDir,
    path.resolve(process.cwd(), 'src', 'core', 'execution', 'live-step'),
  );
  const entityDiscoveryImport = relativeImport(
    outputDir,
    path.resolve(process.cwd(), 'src', 'core', 'discovery', 'entity-discovery'),
  );

  const typesPath = path.resolve(
    process.cwd(),
    'applications',
    spec.application,
    'data',
    'types.ts',
  );
  const hasTypes = fs.existsSync(typesPath);
  const typesContent = hasTypes ? fs.readFileSync(typesPath, 'utf-8') : '';
  // Specifically the *DataProfile* interface (matches the existing naming
  // convention, e.g. HrmsDataProfile) — NOT just the first exported
  // interface in the file, which could be an unrelated shape like a single
  // credential type (HrmsCredential) declared earlier in the same file.
  const typeNameMatch = /export\s+interface\s+(\w*DataProfile\w*)/i.exec(typesContent);
  const dataProfileTypeName = typeNameMatch?.[1];
  const dataTypesImport = hasTypes
    ? relativeImport(
        outputDir,
        path.resolve(process.cwd(), 'applications', spec.application, 'data', 'types'),
      )
    : undefined;

  const loginHelperImports = new Set<string>();
  for (const step of spec.steps) {
    const detail = loginHelperDetail(step);
    if (detail) {
      loginHelperImports.add(
        `import { ${detail.functionName} } from '${relativeImport(outputDir, path.resolve(process.cwd(), 'applications', spec.application, 'fixtures', detail.moduleName))}';`,
      );
    }
  }

  const stableTestId = `${spec.application}.${spec.module}.generated.${index}`;
  const tags = [
    `'@application.${spec.application}'`,
    `'@module.${spec.module}'`,
    'TAGS.FUNCTIONAL',
    "'@generated'",
    // The EXISTING coverage calculator cross-references requirements.json's
    // `tests: [...]` array against tags discovered on real tests — this tag
    // IS `stableTestId` (see requirements-writer.ts), so this generated
    // test registers as covering its requirement with zero coverage-engine
    // changes. Omitting it would silently leave the requirement uncovered.
    `'@${stableTestId}'`,
    `'@requirement.${spec.requirementId}'`,
  ];

  const bodyLines: string[] = [];
  if (usesDateMarkers(spec.steps)) {
    bodyLines.push(
      'const startDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);',
      'const endDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);',
      '',
    );
  }
  // login-helper/login-inline/navigate steps already emit their own
  // page.goto (see stepLines below) — this only covers everything else: a
  // spec whose first step is a plain fill/click/verify still needs to land
  // somewhere before that first action runs, exactly like a hand-written
  // spec would start with its own page.goto. Falls back to '/' (not
  // skipped) when the application has no registered startPath — a browser
  // context starts at about:blank, so a generated test needs an explicit
  // navigation to SOME page before its first interaction regardless of
  // whether that page happens to be the site's own root.
  const firstStepKind = spec.steps[0]?.resolved?.kind;
  const firstStepAlreadyNavigates =
    firstStepKind === 'login-helper' ||
    firstStepKind === 'login-inline' ||
    firstStepKind === 'navigate';
  // Every generated step (the prepended "Open the application" goto and
  // every spec.steps entry) runs inside its own liveStep()/test.step()
  // callback — see live-step.ts — so the live-events reporter can observe
  // per-step begin/end boundaries. 1-based, matching the reporter's own
  // stepIndexByTest counter, which increments the same way in the same
  // order (see live-events-reporter.ts's onStepBegin).
  let liveStepIndex = 0;
  const pushLiveStep = (description: string, lines: string[]): void => {
    liveStepIndex += 1;
    bodyLines.push(
      `await liveStep(${JSON.stringify(description)}, ${liveStepIndex}, page, async () => {`,
      ...lines.map((line) => `  ${line}`),
      `});`,
    );
  };

  if (!firstStepAlreadyNavigates) {
    pushLiveStep('Open the application', [
      `await page.goto(${JSON.stringify(app.startPath ?? '/')});`,
    ]);
  }

  const shouldCaptureSubmitResponse = needsSubmitResponseCapture(spec.steps);
  const needsEntityTracking = usesEntityTracking(spec.steps);
  let submitResponseCaptured = false;
  // Declared once, OUTSIDE every liveStep callback: the submit step and a
  // later verify-api step each run in their own callback's function scope,
  // so a `const` declared inside one would not be visible from the other.
  if (shouldCaptureSubmitResponse) {
    bodyLines.push('let submitResponse: Response;', '');
  }
  // Same cross-callback-scope reasoning as submitResponse above — a
  // select-entity step and a later open-entity/verify step each run in
  // their own liveStep() callback.
  if (needsEntityTracking) {
    bodyLines.push('let selectedEntityLocator: Locator;', "let selectedEntityName = '';", '');
  }
  for (const step of spec.steps) {
    const lines = stepLines(
      step,
      app.startPath,
      shouldCaptureSubmitResponse,
      submitResponseCaptured,
    );
    pushLiveStep(step.step.raw, lines);
    if (
      step.resolved?.kind === 'click' &&
      step.step.target === 'submit' &&
      shouldCaptureSubmitResponse
    ) {
      submitResponseCaptured = true;
    }
  }

  const playwrightTypeImports = [
    ...(shouldCaptureSubmitResponse ? ['Response'] : []),
    ...(needsEntityTracking ? ['Locator'] : []),
  ];
  const importLines = [
    `import { test, expect } from '${baseFixtureImport}';`,
    ...(playwrightTypeImports.length > 0
      ? [`import type { ${playwrightTypeImports.join(', ')} } from '@playwright/test';`]
      : []),
    `import { TAGS } from '${constantsImport}';`,
    `import { loadDataProfile } from '${dataProfileImport}';`,
    `import { getExecutionContext } from '${executionContextImport}';`,
    `import { liveStep } from '${liveStepImport}';`,
    ...(needsEntityTracking ? [`import { selectEntity } from '${entityDiscoveryImport}';`] : []),
    ...loginHelperImports,
    ...(hasTypes && dataProfileTypeName
      ? [`import { ${dataProfileTypeName} } from '${dataTypesImport}';`]
      : []),
  ];

  const profileDecl =
    hasTypes && dataProfileTypeName
      ? `const profile = loadDataProfile<${dataProfileTypeName}>(\n  '${spec.application}',\n  getExecutionContext().dataProfile ?? 'qa-default',\n);`
      : `const profile = loadDataProfile(\n  '${spec.application}',\n  getExecutionContext().dataProfile ?? 'qa-default',\n);`;

  const code = `// GENERATED by \`npm run gap:generate\` from requirement ${spec.requirementId}.
// Regenerating does not overwrite this file automatically — remove it first for a fresh version.
${importLines.join('\n')}

${profileDecl}

test.describe('${app.name} ${capitalize(spec.module)} (generated)', () => {
  test(
    ${JSON.stringify(spec.testName)},
    { tag: [${tags.join(', ')}] },
    async ({ page, ui }) => {
      ${bodyLines.join('\n      ')}
    },
  );
});
`;

  return { filePath, code, stableTestId };
}
