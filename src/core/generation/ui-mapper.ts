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
// Verify — a quoted expected text is asserted directly (the text comes from
// the requirement itself, nothing to score against the ApplicationMap). A
// BARE verify ("Verify confirmation is displayed", no quotes) has no text
// to invent, so it's resolved instead against a discovered ARIA
// "alert"/"status"/"log" region on the current page — the generic,
// app-agnostic signal for "where this app announces a result" — never a
// guessed word/element. See page-crawler.ts's collectConfirmationRegions.
// ---------------------------------------------------------------------------

const API_STATUS_MARKER = /^\{\{api:(\d{3})\}\}$/;

function mapVerify(step: RawStep, currentPage: PageMap | undefined): StepMapping {
  // An EXPLICIT network/API assertion, from requirement-parser.ts's
  // API_STATUS_PATTERN — only ever produced when the requirement itself
  // names an HTTP status code, never inferred. A distinct `kind` (not
  // `verify`) so a plain UI verify's codegen path can never accidentally
  // pick up a network dependency — see code-generator.ts.
  const apiMatch = step.value ? API_STATUS_MARKER.exec(step.value) : null;
  if (apiMatch) {
    return {
      step,
      confidence: 'HIGH',
      resolved: {
        kind: 'verify-api',
        description: `expect(submitResponse.status()).toBe(${apiMatch[1]})`,
        detail: apiMatch[1],
      },
      diagnostics: [],
    };
  }

  if (step.value) {
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

  if (!currentPage) {
    return {
      step,
      confidence: 'LOW',
      unmapped: {
        reason:
          'No page context to look for a confirmation/status element on — this verify step was ' +
          'reached before any page was successfully opened.',
      },
      diagnostics: [],
    };
  }

  const regions = currentPage.confirmationRegions;
  const diagnostics: MappingCandidate[] = regions.map((r) => ({
    label: `${r.role} region`,
    value: r.role,
    score: r.unique ? 100 : 40,
    reasons: [
      r.unique
        ? `a unique, discovered "${r.role}"-role live region on "${currentPage.pageName}" — the generic ARIA signal an app uses to announce a result`
        : `a "${r.role}"-role live region exists on "${currentPage.pageName}" but is not uniquely identifiable`,
    ],
    selected: false,
  }));

  const resolveRole = (role: string): StepMapping => {
    diagnostics.forEach((d) => (d.selected = d.value === role));
    return {
      step,
      confidence: 'HIGH',
      resolved: {
        kind: 'verify',
        strategy: 'role',
        confidence: 'HIGH',
        resolvedLocator: `getByRole('${role}')`,
        description: `expect(page.getByRole('${role}')).toBeVisible()`,
        detail: role,
      },
      diagnostics,
    };
  };

  // A human's disambiguation choice re-parses back in as step.target —
  // same mechanism generation-orchestrator.ts already uses for every other
  // step kind's MEDIUM-confidence retry.
  if (step.target && regions.some((r) => r.role === step.target && r.unique)) {
    return resolveRole(step.target);
  }

  const uniqueRegions = regions.filter((r) => r.unique);
  if (uniqueRegions.length === 1) {
    return resolveRole(uniqueRegions[0].role);
  }
  if (regions.length > 1) {
    return { step, confidence: 'MEDIUM', ambiguous: { candidates: diagnostics }, diagnostics };
  }

  const [only] = regions;
  return {
    step,
    confidence: 'LOW',
    unmapped: {
      reason: only
        ? `A "${only.role}"-role live region exists on "${currentPage.pageName}" but is not uniquely identifiable — cannot safely assert against it.`
        : `No discovered confirmation/status element (ARIA "alert"/"status"/"log" region) found on "${currentPage.pageName}" to verify against.`,
    },
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Navigate — a strictly navigation-intent match: "Open <page>"/"Navigate
// to <page>"/"Go to <page>"/"Visit <page>" is asking which page to land
// on, so only page-identity/navigation evidence counts (name, title, or a
// real verified link that actually points here). Deliberately does NOT
// consider anything about the CURRENT page's own content (a submit
// button, an input, a heading) nor anything from steps that come AFTER
// this one — a page having a login form's submit button, or happening to
// share vocabulary with a later fill/submit step, is not evidence this is
// the page being navigated to. If a heading merely mentions the target
// word, or the page just happens to have some verified button on it,
// that's not navigation evidence either — see findNavigationEvidence.
// ---------------------------------------------------------------------------

// A page's heading is prose, not navigation — "Employee Leave Management"
// on a Login page mentioning the word "Leave" is not evidence anyone can
// actually reach a Leave page from here. Deliberately NOT scored for
// navigate matching (see findNavigationEvidence below for what real
// navigation evidence looks like).
function findNavigationEvidence(
  target: string,
  candidate: PageMap,
  allPages: PageMap[],
): { score: number; reason: string } | undefined {
  for (const page of allPages) {
    for (const link of page.links) {
      if (!link.verified || !link.href || link.href !== candidate.path) continue;
      const evidence = scoreNameMatch(target, link.name);
      if (evidence) {
        return {
          score: 30 + evidence.score,
          reason: `a verified navigation link "${link.name}" (on "${page.pageName}") points to this page and matches "${target}"`,
        };
      }
    }
  }
  return undefined;
}

function scorePages(target: string, pages: PageMap[]): ScoredCandidate<PageMap>[] {
  const results: ScoredCandidate<PageMap>[] = [];

  for (const page of pages) {
    let score = 0;
    const reasons: string[] = [];

    const nameEvidence = scoreNameMatch(target, page.pageName);
    if (nameEvidence) {
      score += nameEvidence.score;
      reasons.push(nameEvidence.reason);
    }

    const navEvidence = findNavigationEvidence(target, page, pages);
    if (navEvidence) {
      score += navEvidence.score;
      reasons.push(navEvidence.reason);
    }

    if (page.title && page.title !== page.pageName && scoreNameMatch(target, page.title)) {
      score += 10;
      reasons.push(`page title "${page.title}" also matches "${target}"`);
    }

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
      mappings.push(mapVerify(step, currentPage));
      continue;
    }

    if (step.action === 'navigate') {
      const target = step.target ?? '';
      const outcome = finalizeNavigate(step, target, scorePages(target, map.pages));
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
