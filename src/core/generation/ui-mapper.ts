import * as fs from 'fs';
import * as path from 'path';
import { ApplicationMap, DiscoveredElement, PageMap } from '../discovery/discovery-types';
import { RawStep, StepMapping } from './generation-types';

interface MatchResult<T> {
  match?: T;
  /** Names of every partial match, when there wasn't exactly one — distinguishes "0 found" from "ambiguous" for the error message. */
  candidates: string[];
}

function matchOne<T>(items: T[], nameOf: (item: T) => string, target: string): MatchResult<T> {
  const lower = target.toLowerCase();
  const found = items.filter((item) => nameOf(item).toLowerCase().includes(lower));
  if (found.length === 1) return { match: found[0], candidates: [] };
  return { match: undefined, candidates: found.map(nameOf) };
}

function unmappedReason(kind: string, target: string, scope: string, candidates: string[]): string {
  if (candidates.length > 1) {
    return `Multiple ${kind} match "${target}"${scope}: ${candidates.join(', ')}. Be more specific in the requirement.`;
  }
  return `No discovered, verified ${kind} matches "${target}"${scope}.`;
}

/**
 * Searches applications/<id>/fixtures/*.ts for an existing
 * `export async function loginAsXxx(...)` to reuse instead of generating
 * inline login. Returns only the fixture's module name (no extension) and
 * function name — NOT a relative import path, since this module has no
 * idea where the generated file will actually live; code-generator.ts
 * computes the correct relative path from the real output location.
 */
function findLoginHelper(
  application: string,
): { moduleName: string; functionName: string } | undefined {
  const fixturesDir = path.resolve(process.cwd(), 'applications', application, 'fixtures');
  if (!fs.existsSync(fixturesDir)) return undefined;
  for (const file of fs.readdirSync(fixturesDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
    const match = /export\s+async\s+function\s+(loginAs\w*)\s*\(/.exec(content);
    if (match) {
      return { moduleName: file.replace(/\.ts$/, ''), functionName: match[1] };
    }
  }
  return undefined;
}

function profileKeyFor(target: string | undefined): string {
  return target && /manager/i.test(target) ? 'manager' : 'employee';
}

function mapLogin(application: string, step: RawStep, map: ApplicationMap): StepMapping {
  const profileKey = profileKeyFor(step.target);
  const helper = findLoginHelper(application);
  if (helper) {
    return {
      step,
      resolved: {
        kind: 'login-helper',
        description: `${helper.functionName}(page, ui, profile.${profileKey})`,
        detail: JSON.stringify({
          moduleName: helper.moduleName,
          functionName: helper.functionName,
          profileKey,
        }),
      },
    };
  }

  // No reusable helper — fall back to inline login built from a discovered
  // login-looking page, still going through the same verified username/
  // password/button elements discovery already proved resolvable.
  const loginPage = map.pages.find((p) => p.pageName.toLowerCase().includes('login'));
  if (!loginPage) {
    return {
      step,
      unmapped: {
        reason:
          `No reusable login helper under applications/${application}/fixtures/, and no discovered page ` +
          'looks like a login page. Run discovery against an unauthenticated login URL first.',
      },
    };
  }
  const username = loginPage.inputs.find((i) => /user/i.test(i.name) && i.verified);
  const password = loginPage.inputs.find((i) => /pass/i.test(i.name) && i.verified);
  const loginButton = loginPage.buttons.find((b) => /log\s*in/i.test(b.name) && b.verified);
  if (!username || !password || !loginButton) {
    return {
      step,
      unmapped: {
        reason: `Found a login-looking page ("${loginPage.pageName}") but couldn't confidently identify verified username/password/login-button fields on it.`,
      },
    };
  }
  return {
    step,
    resolved: {
      kind: 'login-inline',
      description:
        `page.goto('${loginPage.path}'); ui.fill('${username.name}', profile.${profileKey}.username); ` +
        `ui.fill('${password.name}', profile.${profileKey}.password); ui.click('${loginButton.name}')`,
      detail: JSON.stringify({
        path: loginPage.path,
        username: username.name,
        password: password.name,
        button: loginButton.name,
        profileKey,
      }),
    },
  };
}

function describeValue(value: string | undefined): string {
  if (value === '{{date:start}}') return 'startDate';
  if (value === '{{date:end}}') return 'endDate';
  return `'${value}'`;
}

/**
 * Maps each RawStep to a discovered, LocatorResolver-verified element from
 * the ApplicationMap — the ONLY source used for mapping (per spec). A step
 * that can't be confidently, uniquely resolved comes back with `unmapped`
 * instead of a best-effort guess.
 */
export function mapRequirementToUI(
  application: string,
  map: ApplicationMap,
  steps: RawStep[],
): StepMapping[] {
  const mappings: StepMapping[] = [];
  let currentPage: PageMap | undefined;

  for (const step of steps) {
    if (step.action === 'login') {
      mappings.push(mapLogin(application, step, map));
      continue;
    }

    if (step.action === 'navigate') {
      const target = step.target ?? '';
      const { match, candidates } = matchOne(map.pages, (p) => p.pageName, target);
      if (!match) {
        mappings.push({
          step,
          unmapped: { reason: unmappedReason('page', target, '', candidates) },
        });
        continue;
      }
      currentPage = match;
      mappings.push({
        step,
        resolved: {
          kind: 'navigate',
          description: `page.goto('${match.path}')`,
          detail: match.path,
        },
      });
      continue;
    }

    if (step.action === 'verify') {
      if (!step.value) {
        mappings.push({
          step,
          unmapped: {
            reason: 'Verify step has no expected text — state it in quotes, e.g. verify "Success".',
          },
        });
        continue;
      }
      mappings.push({
        step,
        resolved: {
          kind: 'verify',
          description: `expect(page.getByText("${step.value}")).toBeVisible()`,
          detail: step.value,
        },
      });
      continue;
    }

    const scope = currentPage ? ` on page "${currentPage.pageName}"` : '';
    const pool = currentPage ? [currentPage] : map.pages;
    const target =
      step.action === 'click' && step.target === 'submit' ? 'submit' : (step.target ?? '');

    if (step.action === 'fill') {
      const candidates: { el: DiscoveredElement }[] = pool.flatMap((p) =>
        p.inputs.map((el) => ({ el })),
      );
      const { match, candidates: names } = matchOne(candidates, (c) => c.el.name, target);
      if (!match || !match.el.verified) {
        mappings.push({
          step,
          unmapped: {
            reason: match
              ? `Field "${target}" was discovered but is not currently verified as uniquely fillable.`
              : unmappedReason('input', target, scope, names),
          },
        });
        continue;
      }
      mappings.push({
        step,
        resolved: {
          kind: 'fill',
          description: `ui.fill('${match.el.name}', ${describeValue(step.value)})`,
          strategy: match.el.verified.strategy,
          confidence: match.el.verified.confidence,
          resolvedLocator: match.el.verified.resolvedLocator,
          detail: match.el.name,
        },
      });
      continue;
    }

    // click
    const candidates: { el: DiscoveredElement }[] = pool.flatMap((p) =>
      [...p.buttons, ...p.links].map((el) => ({ el })),
    );
    const { match, candidates: names } = matchOne(candidates, (c) => c.el.name, target);
    if (!match || !match.el.verified) {
      mappings.push({
        step,
        unmapped: {
          reason: match
            ? `"${target}" was discovered but is not currently verified as uniquely clickable.`
            : unmappedReason('button/link', target, scope, names),
        },
      });
      continue;
    }
    mappings.push({
      step,
      resolved: {
        kind: 'click',
        description: `ui.click('${match.el.name}')`,
        strategy: match.el.verified.strategy,
        confidence: match.el.verified.confidence,
        resolvedLocator: match.el.verified.resolvedLocator,
        detail: match.el.name,
      },
    });
  }

  return mappings;
}
