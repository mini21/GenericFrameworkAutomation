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

function valueExpression(rawValue: string | undefined): string {
  if (rawValue === '{{date:start}}') return 'startDate';
  if (rawValue === '{{date:end}}') return 'endDate';
  return JSON.stringify(rawValue ?? '');
}

function usesDateMarkers(steps: StepMapping[]): boolean {
  return steps.some((s) => s.step.value === '{{date:start}}' || s.step.value === '{{date:end}}');
}

/**
 * Only capture the submit action's HTTP response when there's exactly one
 * submit click AND a role-based (bare) verify in the spec to consume it —
 * anything else (a quoted-text verify, no verify at all, or more than one
 * submit) falls back to a plain click, so a `submitResponse` variable is
 * never declared and left unused (which would fail the generated file's
 * own lint step) and never redeclared (a real submit-then-submit flow).
 */
function needsSubmitResponseCapture(steps: StepMapping[]): boolean {
  const submitClicks = steps.filter(
    (s) => s.resolved?.kind === 'click' && s.step.target === 'submit',
  );
  const hasRoleVerify = steps.some(
    (s) => s.resolved?.kind === 'verify' && s.resolved.strategy === 'role',
  );
  return submitClicks.length === 1 && hasRoleVerify;
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
        `await ui.click(${JSON.stringify(detail.button)});`,
      ];
    }
    case 'navigate':
      return [`await page.goto(${JSON.stringify(resolved.detail ?? '')});`];
    case 'fill':
      return [
        `await ui.fill(${JSON.stringify(resolved.detail ?? '')}, ${valueExpression(step.step.value)});`,
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
        return [
          `const [submitResponse] = await Promise.all([`,
          `  page.waitForResponse((response) => response.request().method() !== 'GET'),`,
          `  ui.click(${JSON.stringify(resolved.detail ?? '')}),`,
          `]);`,
        ];
      }
      return [`await ui.click(${JSON.stringify(resolved.detail ?? '')});`];
    case 'verify': {
      // A quoted expected text asserts by text; a bare verify resolved
      // against a discovered ARIA live region (see ui-mapper.ts's
      // mapVerify) asserts by role instead — resolved.strategy === 'role'
      // is the marker distinguishing the two, same field LocatorResolver
      // itself already uses for fill/click steps.
      if (resolved.strategy !== 'role') {
        return [
          `await expect(page.getByText(${JSON.stringify(resolved.detail ?? '')})).toBeVisible();`,
        ];
      }
      const lines: string[] = [];
      if (submitResponseCaptured) {
        lines.push(`expect(submitResponse.ok()).toBe(true);`);
      }
      lines.push(
        `await expect(page.getByRole(${JSON.stringify(resolved.detail ?? '')})).toBeVisible();`,
      );
      return lines;
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
  const shouldCaptureSubmitResponse = needsSubmitResponseCapture(spec.steps);
  let submitResponseCaptured = false;
  for (const step of spec.steps) {
    bodyLines.push(
      ...stepLines(step, app.startPath, shouldCaptureSubmitResponse, submitResponseCaptured),
    );
    if (
      step.resolved?.kind === 'click' &&
      step.step.target === 'submit' &&
      shouldCaptureSubmitResponse
    ) {
      submitResponseCaptured = true;
    }
  }

  const importLines = [
    `import { test, expect } from '${baseFixtureImport}';`,
    `import { TAGS } from '${constantsImport}';`,
    `import { loadDataProfile } from '${dataProfileImport}';`,
    `import { getExecutionContext } from '${executionContextImport}';`,
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
