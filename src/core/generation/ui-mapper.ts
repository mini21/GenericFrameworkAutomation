import * as fs from 'fs';
import * as path from 'path';
import { ApplicationMap, DiscoveredElement, PageMap } from '../discovery/discovery-types';
import { MappingCandidate, RawStep, StepMapping } from './generation-types';
import {
  classifyConfidence,
  rankCandidates,
  scoreNameMatch,
  ScoredCandidate,
} from './element-scorer';

const MAX_DISPLAYED_CANDIDATES = 5;

// ---------------------------------------------------------------------------
// Login (unchanged from Phase 1 — doesn't go through scoring, it's either a
// reusable helper or a discovered login page, both structurally different
// from "pick the best-scoring page/element" matching).
// ---------------------------------------------------------------------------

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
      confidence: 'HIGH',
      resolved: {
        kind: 'login-helper',
        description: `${helper.functionName}(page, ui, profile.${profileKey})`,
        detail: JSON.stringify({
          moduleName: helper.moduleName,
          functionName: helper.functionName,
          profileKey,
        }),
      },
      diagnostics: [],
    };
  }

  const loginPage = map.pages.find((p) => p.pageName.toLowerCase().includes('login'));
  if (!loginPage) {
    return {
      step,
      confidence: 'LOW',
      unmapped: {
        reason:
          `No reusable login helper under applications/${application}/fixtures/, and no discovered page ` +
          'looks like a login page. Run discovery against an unauthenticated login URL first.',
      },
      diagnostics: [],
    };
  }
  const username = loginPage.inputs.find((i) => /user/i.test(i.name) && i.verified);
  const password = loginPage.inputs.find((i) => /pass/i.test(i.name) && i.verified);
  const loginButton = loginPage.buttons.find((b) => /log\s*in/i.test(b.name) && b.verified);
  if (!username || !password || !loginButton) {
    return {
      step,
      confidence: 'LOW',
      unmapped: {
        reason: `Found a login-looking page ("${loginPage.pageName}") but couldn't confidently identify verified username/password/login-button fields on it.`,
      },
      diagnostics: [],
    };
  }
  return {
    step,
    confidence: 'HIGH',
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
    diagnostics: [],
  };
}

// ---------------------------------------------------------------------------
// Verify (unchanged — the expected text comes from the requirement itself,
// there's nothing on the ApplicationMap to score it against).
// ---------------------------------------------------------------------------

function mapVerify(step: RawStep): StepMapping {
  if (!step.value) {
    return {
      step,
      confidence: 'LOW',
      unmapped: {
        reason: 'Verify step has no expected text — state it in quotes, e.g. verify "Success".',
      },
      diagnostics: [],
    };
  }
  return {
    step,
    confidence: 'HIGH',
    resolved: {
      kind: 'verify',
      description: `expect(page.getByText("${step.value}")).toBeVisible()`,
      detail: step.value,
    },
    diagnostics: [],
  };
}

// ---------------------------------------------------------------------------
// Navigate — scored against every discovered page. Beyond name/heading/
// title similarity, a page also earns credit for containing verified
// elements that match the UPCOMING steps in the same mini-scenario (the
// steps between this navigation and the next one) — this is what lets
// "Open Leave" resolve to "Apply Leave" over "Leave History" when the next
// steps fill Start/End Date and submit: evidence from the *rest of the
// scenario*, not a guess or an HRMS-specific rule.
// ---------------------------------------------------------------------------

function corroboratePage(
  page: PageMap,
  upcomingSteps: RawStep[],
): { bonus: number; reasons: string[] } {
  let bonus = 0;
  const reasons: string[] = [];

  for (const step of upcomingSteps) {
    if (step.action === 'navigate') break; // corroboration window ends at the next navigation
    if (step.action === 'login' || step.action === 'verify') continue; // not page-local evidence

    if (step.action === 'click' && step.target === 'submit') {
      if (page.buttons.some((b) => b.isSubmit && b.verified)) {
        bonus += 20;
        reasons.push(`has a verified native submit control, matching upcoming step "${step.raw}"`);
      }
      continue;
    }

    const target = step.target;
    if (!target) continue;
    const pool: DiscoveredElement[] = [
      ...page.inputs,
      ...page.buttons,
      ...page.links,
      ...page.checkboxes,
    ];
    const hit = pool.find((el) => el.verified && scoreNameMatch(target, el.name));
    if (hit) {
      bonus += 20;
      reasons.push(`has a verified element "${hit.name}" matching upcoming step "${step.raw}"`);
    }
  }

  return { bonus: Math.min(bonus, 60), reasons };
}

function scorePages(
  target: string,
  pages: PageMap[],
  upcomingSteps: RawStep[],
): ScoredCandidate<PageMap>[] {
  const results: ScoredCandidate<PageMap>[] = [];

  for (const page of pages) {
    let score = 0;
    const reasons: string[] = [];

    const nameEvidence = scoreNameMatch(target, page.pageName);
    if (nameEvidence) {
      score += nameEvidence.score;
      reasons.push(nameEvidence.reason);
    }

    for (const heading of page.headings) {
      const evidence = scoreNameMatch(target, heading);
      if (evidence) {
        score += 15;
        reasons.push(`heading "${heading}" also matches "${target}"`);
        break;
      }
    }

    if (page.title && page.title !== page.pageName && scoreNameMatch(target, page.title)) {
      score += 10;
      reasons.push(`page title "${page.title}" also matches "${target}"`);
    }

    const { bonus, reasons: corroborationReasons } = corroboratePage(page, upcomingSteps);
    score += bonus;
    reasons.push(...corroborationReasons);

    if (score > 0) results.push({ item: page, score, reasons });
  }

  return results;
}

function toCandidates<T>(
  ranked: ScoredCandidate<T>[],
  labelOf: (item: T) => string,
): MappingCandidate[] {
  return ranked.slice(0, MAX_DISPLAYED_CANDIDATES).map((c) => ({
    label: labelOf(c.item),
    value: labelOf(c.item),
    score: c.score,
    reasons: c.reasons,
    selected: false,
  }));
}

interface NavigateOutcome {
  mapping: StepMapping;
  chosenPage?: PageMap;
}

function finalizeNavigate(
  step: RawStep,
  target: string,
  scored: ScoredCandidate<PageMap>[],
): NavigateOutcome {
  const ranked = rankCandidates(scored);
  const diagnostics = toCandidates(ranked, (p) => p.pageName);

  if (ranked.length === 0) {
    return {
      mapping: {
        step,
        confidence: 'LOW',
        unmapped: { reason: `No discovered page provides any evidence for "${target}".` },
        diagnostics,
      },
    };
  }

  const top = ranked[0];
  const confidence = classifyConfidence(top.score, ranked[1]?.score ?? 0);

  if (confidence === 'LOW') {
    return {
      mapping: {
        step,
        confidence,
        unmapped: {
          reason: `No discovered page confidently matches "${target}". Best candidate: "${top.item.pageName}" (score ${top.score}: ${top.reasons.join('; ')}).`,
        },
        diagnostics,
      },
    };
  }

  if (confidence === 'MEDIUM') {
    return {
      mapping: {
        step,
        confidence,
        ambiguous: { candidates: diagnostics },
        diagnostics,
      },
    };
  }

  diagnostics[0].selected = true;
  return {
    mapping: {
      step,
      confidence: 'HIGH',
      resolved: {
        kind: 'navigate',
        description: `page.goto('${top.item.path}')`,
        detail: top.item.path,
      },
      diagnostics,
    },
    chosenPage: top.item,
  };
}

// ---------------------------------------------------------------------------
// Fill / click — scored against a page's (or, before any navigation, every
// page's) inputs/buttons/links. Beyond name similarity, an input's HTML
// `type` corroborates when the step's own wording mentions it (e.g. "date"),
// and a button's native submit-control status corroborates the generic
// "submit the ... request/form/application" marker — both are DOM facts
// discovery already captured, not app-specific rules.
// ---------------------------------------------------------------------------

function describeValue(rawValue: string | undefined): string {
  if (rawValue === '{{date:start}}') return 'startDate';
  if (rawValue === '{{date:end}}') return 'endDate';
  return `'${rawValue}'`;
}

function scoreElements(
  step: RawStep,
  pool: DiscoveredElement[],
): ScoredCandidate<DiscoveredElement>[] {
  const isSubmitMarker = step.action === 'click' && step.target === 'submit';
  const target = isSubmitMarker ? undefined : step.target;
  const results: ScoredCandidate<DiscoveredElement>[] = [];

  for (const el of pool) {
    let score = 0;
    const reasons: string[] = [];

    if (isSubmitMarker) {
      if (el.isSubmit) {
        score += 70;
        reasons.push('element is the form\'s native submit control (type="submit")');
      }
    } else if (target) {
      const nameEvidence = scoreNameMatch(target, el.name);
      if (nameEvidence) {
        score += nameEvidence.score;
        reasons.push(nameEvidence.reason);
      }
      if (nameEvidence && el.isSubmit) {
        score += 10;
        reasons.push("also the form's native submit control");
      }
    }

    if (
      step.action === 'fill' &&
      el.inputType &&
      step.raw.toLowerCase().includes(el.inputType.toLowerCase())
    ) {
      score += 15;
      reasons.push(`input type "${el.inputType}" corroborates the step's wording`);
    }

    if (score > 0) results.push({ item: el, score, reasons });
  }

  return results;
}

function finalizeElement(step: RawStep, scored: ScoredCandidate<DiscoveredElement>[]): StepMapping {
  const actionLabel = step.action === 'fill' ? 'fillable' : 'clickable';
  const targetLabel =
    step.action === 'click' && step.target === 'submit' ? 'a submit control' : `"${step.target}"`;
  const ranked = rankCandidates(scored);
  const diagnostics = toCandidates(ranked, (el) => el.name);

  if (ranked.length === 0) {
    return {
      step,
      confidence: 'LOW',
      unmapped: { reason: `No discovered element provides any evidence for ${targetLabel}.` },
      diagnostics,
    };
  }

  const top = ranked[0];
  const confidence = classifyConfidence(top.score, ranked[1]?.score ?? 0);

  if (confidence === 'LOW') {
    return {
      step,
      confidence,
      unmapped: {
        reason: `No discovered element confidently matches ${targetLabel}. Best candidate: "${top.item.name}" (score ${top.score}: ${top.reasons.join('; ')}).`,
      },
      diagnostics,
    };
  }

  if (confidence === 'MEDIUM') {
    return { step, confidence, ambiguous: { candidates: diagnostics }, diagnostics };
  }

  if (!top.item.verified) {
    return {
      step,
      confidence: 'LOW',
      unmapped: {
        reason: `"${top.item.name}" scored as the best match for ${targetLabel} but is not currently verified as uniquely ${actionLabel}.`,
      },
      diagnostics,
    };
  }

  diagnostics[0].selected = true;
  return {
    step,
    confidence: 'HIGH',
    resolved: {
      kind: step.action === 'fill' ? 'fill' : 'click',
      description:
        step.action === 'fill'
          ? `ui.fill('${top.item.name}', ${describeValue(step.value)})`
          : `ui.click('${top.item.name}')`,
      strategy: top.item.verified.strategy,
      confidence: top.item.verified.confidence,
      resolvedLocator: top.item.verified.resolvedLocator,
      detail: top.item.name,
    },
    diagnostics,
  };
}

// ---------------------------------------------------------------------------

/**
 * Maps each RawStep to a discovered, LocatorResolver-verified element from
 * the ApplicationMap using a generic, evidence-scored matcher (see
 * element-scorer.ts) — never a hardcoded name alias. HIGH confidence maps
 * automatically; MEDIUM returns ranked candidates for the caller to confirm
 * (see cli/lib/generation-approval.ts); LOW is reported, never guessed.
 */
export function mapRequirementToUI(
  application: string,
  map: ApplicationMap,
  steps: RawStep[],
): StepMapping[] {
  const mappings: StepMapping[] = [];
  let currentPage: PageMap | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.action === 'login') {
      mappings.push(mapLogin(application, step, map));
      continue;
    }
    if (step.action === 'verify') {
      mappings.push(mapVerify(step));
      continue;
    }

    if (step.action === 'navigate') {
      const target = step.target ?? '';
      const outcome = finalizeNavigate(
        step,
        target,
        scorePages(target, map.pages, steps.slice(i + 1)),
      );
      mappings.push(outcome.mapping);
      if (outcome.chosenPage) currentPage = outcome.chosenPage;
      continue;
    }

    // fill / click
    const pool = currentPage
      ? step.action === 'fill'
        ? currentPage.inputs
        : [...currentPage.buttons, ...currentPage.links]
      : map.pages.flatMap((p) => (step.action === 'fill' ? p.inputs : [...p.buttons, ...p.links]));

    mappings.push(finalizeElement(step, scoreElements(step, pool)));
  }

  return mappings;
}
