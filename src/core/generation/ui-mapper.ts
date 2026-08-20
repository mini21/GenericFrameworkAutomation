import * as fs from 'fs';
import * as path from 'path';
import { ApplicationMap, DiscoveredElement, PageMap } from '../discovery/discovery-types';
import { MappingCandidate, RawStep, StepMapping } from './generation-types';
import { hasApplication, getApplication } from '../config/application-registry';
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

// Derives a data-profile key straight from the login step's own wording —
// "Login as admin" -> "admin", "Login as manager" -> "manager", "Login as
// an employee" -> "employee" (a leading article is generic English noise,
// not part of the role name) — instead of a fixed employee/manager
// vocabulary. Any application's own data/<profile>.json simply names its
// profiles however its own login step's wording does; this never needs a
// framework change to support a new role name for a new application (e.g.
// "Login as admin" for an admin panel, "Login as customer" for a shop).
// Falls back to "default" only when a login step somehow carries no target
// at all (LOGIN_PATTERN always captures one in practice).
function profileKeyFor(target: string | undefined): string {
  const withoutArticle = (target ?? '').trim().replace(/^(a|an|the)\s+/i, '');
  const firstWord = withoutArticle.split(/\s+/)[0];
  return firstWord ? firstWord.toLowerCase() : 'default';
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

/**
 * The most recent preceding fill step's literal value, up to (not
 * including) `beforeIndex` — the "what did the user just type" context a
 * content-type verify uses (see CONTENT_WORDING below). Skips synthetic
 * `{{date:*}}` markers (see code-generator.ts's valueExpression) — a
 * computed date is never something a results page would echo back as
 * visible text, so it's never useful evidence here.
 */
function mostRecentFillValue(steps: RawStep[], beforeIndex: number): string | undefined {
  for (let j = beforeIndex - 1; j >= 0; j--) {
    const s = steps[j];
    if (s.action === 'fill' && s.value && !/^\{\{.*\}\}$/.test(s.value)) {
      return s.value;
    }
  }
  return undefined;
}

// A bare verify is NOT one undifferentiated "something was announced"
// check — a NOTIFICATION assertion ("success message", "error", "warning",
// "confirmation") and a CONTENT assertion ("search results", "product
// list", "matching items") ask fundamentally different questions. An ARIA
// live region genuinely answers the first ("did the app announce
// something?") but NOT the second ("is the actual result content on
// screen?") — a status/alert region can exist and stay empty while a full
// results page renders via ordinary navigation, no live-region involved at
// all (a very common real pattern: results appear via a full page load,
// not a dynamic in-place update). Generic English vocabulary only — the
// same regex matches "search results"/"product list"/"matching items" for
// ANY application, never a fixed per-app word list.
const CONTENT_WORDING = /\b(results?|items?|products?|matches?|cards?|listings?|\blist\b)\b/i;

function mapVerify(
  step: RawStep,
  currentPage: PageMap | undefined,
  precedingFillValue: string | undefined,
): StepMapping {
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

  // CONTENT assertion ("search results"/"product list"/"matching items"
  // are displayed) — a live region is never automatically the right
  // implementation here (see CONTENT_WORDING's comment above). The one
  // generic, app-agnostic signal available without a second, dynamic
  // discovery pass against a page that was never crawled (the results
  // page only exists AFTER the preceding submit runs — discovery, which
  // only follows static links, never saw it) is the value the PRECEDING
  // fill step actually typed: whatever a real search/filter feature does
  // with that term, showing it back somewhere on the resulting page (a
  // "results for X" heading, a matching product title, ...) is close to
  // universal — this is exactly the "text containing the searched term"
  // evidence a human reviewing the page would look for too. `.first()`
  // because a real results page often repeats the term (once in a
  // heading, again in several result titles) — asserting "at least one
  // exists" is the correct, non-guessing claim, not "exactly one".
  // Never falls back to guessing an alert/status region instead — if
  // there's no preceding fill value to check for, this honestly reports
  // unmapped rather than picking a mechanism that doesn't answer the
  // actual question asked.
  if (CONTENT_WORDING.test(step.raw)) {
    if (precedingFillValue) {
      return {
        step,
        confidence: 'HIGH',
        resolved: {
          kind: 'verify',
          strategy: 'text',
          confidence: 'HIGH',
          resolvedLocator: `getByText(${JSON.stringify(precedingFillValue)}).first()`,
          description: `expect(page.getByText(${JSON.stringify(precedingFillValue)}).first()).toBeVisible()`,
          detail: precedingFillValue,
        },
        diagnostics: [
          {
            label: `text containing "${precedingFillValue}"`,
            value: precedingFillValue,
            score: 70,
            reasons: [
              `the step asks about result/content, not a notification — the preceding step's own ` +
                `search term ("${precedingFillValue}") appearing anywhere on "${currentPage.pageName}" ` +
                'is the generic evidence that real result content rendered, not just that something ' +
                'was announced',
            ],
            selected: true,
            matchConfidence: 'High',
          },
        ],
      };
    }
    return {
      step,
      confidence: 'LOW',
      unmapped: {
        reason:
          'This assertion asks about result/content ("results"/"items"/"list"/...), which an ARIA ' +
          "alert/status region does not reliably represent — and there is no preceding fill step's " +
          'own value to check the page for instead. Rephrase with the exact expected text (e.g. ' +
          'Verify "3 results found" is shown), or add a preceding fill step this can use as context.',
      },
      diagnostics: [],
    };
  }

  const regions = currentPage.confirmationRegions;

  // alert/status/log are NOT three competing business choices — they're
  // the SAME generic W3C mechanism ("a live region announcing a result")
  // expressed via three roles of different specificity (see
  // page-crawler.ts's collectConfirmationRegions, which buckets all three
  // together as exactly this one concept). Asking a Manual QA to pick
  // between them is asking them to make a technical accessibility-role
  // decision that has nothing to do with the business requirement — so
  // whenever more than one is uniquely identifiable, the resolver picks
  // among them itself using generic ARIA authoring-practice semantics, not
  // app knowledge, and — since the two roles genuinely serve DIFFERENT
  // typical purposes — using the step's OWN wording (never any app's
  // vocabulary) to pick the more fitting one:
  //   - `status` (implicit aria-live="polite") is what W3C's own ARIA
  //     Authoring Practices names as the canonical role for advisory,
  //     successful-outcome announcements — its own textbook example is a
  //     search results count. The right default for an ordinary "Verify
  //     ... is displayed/shown" business assertion.
  //   - `alert` (implicit aria-live="assertive") is reserved for
  //     important, time-sensitive information — its own textbook example
  //     is a form validation error — so it's preferred specifically when
  //     the step's own text names an error/failure outcome.
  //   - `log` is a running history rather than a single one-shot result,
  //     so it's never preferred, only a last resort.
  // This is fixed, generic English vocabulary (never "if amazon"/"if
  // hrms"), so it applies identically to any application.
  const ERROR_WORDING = /\b(error|fail(?:s|ed|ure)?|invalid|reject(?:s|ed)?|warn(?:s|ing)?)\b/i;
  const expectsError = ERROR_WORDING.test(step.raw);
  const ROLE_PRIORITY: Record<string, number> = expectsError
    ? { alert: 3, status: 2, log: 1 }
    : { status: 3, alert: 2, log: 1 };

  const diagnostics: MappingCandidate[] = regions.map((r) => ({
    label: `${r.role} region`,
    value: r.role,
    score: r.unique ? 60 + ROLE_PRIORITY[r.role] * 10 : 40,
    reasons: [
      r.unique
        ? `a unique, discovered "${r.role}"-role live region on "${currentPage.pageName}" — the generic ARIA signal an app uses to announce a result`
        : `a "${r.role}"-role live region exists on "${currentPage.pageName}" but is not uniquely identifiable`,
    ],
    selected: false,
    matchConfidence: r.unique ? 'High' : 'Low',
  }));

  const resolveRole = (role: string, extraReason?: string): StepMapping => {
    diagnostics.forEach((d) => {
      d.selected = d.value === role;
      if (d.selected && extraReason) d.reasons.push(extraReason);
    });
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
  // step kind's MEDIUM-confidence retry. Still honored, even though it's
  // no longer reachable via a fresh ambiguity question below — a stored/
  // reused answer from before this policy existed must keep working.
  if (step.target && regions.some((r) => r.role === step.target && r.unique)) {
    return resolveRole(step.target);
  }

  // ANY unique confirmation region is a safe, generic signal — auto-select
  // the highest-priority one. Never asks merely because more than one
  // exists (see comment above); only a page with NO uniquely-identifiable
  // region at all has nothing safe to select from.
  const uniqueRegions = regions.filter((r) => r.unique);
  if (uniqueRegions.length > 0) {
    const best = [...uniqueRegions].sort(
      (a, b) => ROLE_PRIORITY[b.role] - ROLE_PRIORITY[a.role],
    )[0];
    const whyBest = expectsError
      ? `the step's own wording names an error/failure outcome, and "${best.role}" is the role ARIA authoring practice reserves for important, time-sensitive announcements like validation errors`
      : `"${best.role}" is the role ARIA authoring practice canonically uses for advisory result announcements (e.g. a search results count), the closer generic match for an ordinary "is displayed/shown" assertion`;
    const reason =
      uniqueRegions.length > 1
        ? `preferred over ${uniqueRegions
            .filter((r) => r.role !== best.role)
            .map((r) => `"${r.role}"`)
            .join(
              ' and ',
            )} — alert/status/log are equally valid generic result-announcement signals; ${whyBest}`
        : undefined;
    return resolveRole(best.role, reason);
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

/** Same tiering as classifyConfidence's own thresholds, exposed per-candidate for display. */
function matchConfidenceFor(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 60) return 'High';
  if (score >= 20) return 'Medium';
  return 'Low';
}

function toCandidates<T>(
  ranked: ScoredCandidate<T>[],
  labelOf: (item: T) => string,
  contextOf?: (item: T) =>
    | {
        pageName: string;
        pageUrl: string;
        samePage?: boolean;
        elementType?: string;
        formLabel?: string;
      }
    | undefined,
  /**
   * The token re-parsed back into `step.target` when a human picks this
   * candidate — defaults to the same display label, but a form-scoped
   * element (see FORM_PIN_PATTERN below) needs `value` to also carry WHICH
   * form, since two candidates can otherwise share the exact same label
   * ("Submit" in the Employee form vs "Submit" in the Manager form) and a
   * plain-name re-parse could never tell the human's two possible answers
   * apart.
   */
  valueOf?: (item: T) => string,
): MappingCandidate[] {
  return ranked.slice(0, MAX_DISPLAYED_CANDIDATES).map((c) => {
    const ctx = contextOf?.(c.item);
    return {
      label: labelOf(c.item),
      value: (valueOf ?? labelOf)(c.item),
      score: c.score,
      reasons: c.reasons,
      selected: false,
      matchConfidence: matchConfidenceFor(c.score),
      pageName: ctx?.pageName,
      pageUrl: ctx?.pageUrl,
      elementType: ctx?.elementType,
      formLabel: ctx?.formLabel,
      relationship:
        ctx?.samePage === undefined
          ? undefined
          : ctx.samePage
            ? "Same page as the previous step's resolved element"
            : "A different page than the previous step's resolved element",
    };
  });
}

/** Plain-English element kind for an ARIA role — never technical jargon in a UI-facing string. */
function humanElementType(role: string): string {
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') return 'input';
  if (role === 'combobox' || role === 'listbox') return 'dropdown';
  if (role === 'checkbox' || role === 'radio') return role;
  if (role === 'link') return 'link';
  if (role === 'button') return 'button';
  return role;
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
//
// A step never scores in isolation: an element candidate is tagged with the
// page it was actually discovered on (`ElementCandidate`), and when the
// step's pool was scoped by a page a PRECEDING step resolved to
// (`contextPage`, threaded in from mapRequirementToUI), every candidate on
// that same page gets a contextual bonus. This is the generic fix for
// "same text repeated identically across many pages" (e.g. a site-wide
// header search control appearing on every page with an identical
// accessible name): without page context, those candidates are genuinely
// indistinguishable by name alone and correctly stay ambiguous; with it,
// the one instance that's actually on the page the previous step just
// acted on outscores the rest — not because of anything Search-specific,
// but because "the control a real user would reach next is the one on the
// page they're already on" is true for any app/workflow.
//
// The FIRST fill/click step (no preceding step at all) gets the same kind
// of bonus from a different, equally generic source: the application's own
// configured start page (`config/applications.json`'s `startPath`, default
// '/') — the exact page code-generator.ts's prepended `page.goto(...)`
// actually lands the generated test on before its first action runs (see
// generateSpecFile). A candidate that happens to live there is, concretely,
// on the one page this step's action will really execute against — real
// structural context, not a guess, and only ever a scoring bonus (never a
// pool restriction the way a genuinely resolved `contextPage` is), so a
// step whose real evidence points elsewhere still wins normally.
// ---------------------------------------------------------------------------

interface ElementCandidate {
  element: DiscoveredElement;
  page: PageMap;
}

// A form-scoped candidate's re-parse token (see toCandidates' `valueOf`
// above), built around a NUL character — a control character that can
// never appear in a real accessible name, so this separator is always
// unambiguous. Lets a human's disambiguation answer pin down not just a
// NAME ("Submit") but WHICH of several same-named form-scoped controls —
// see scoreElements below, which turns a pinned target into an exact,
// unambiguous match instead of re-running the same tied scoring that
// produced the ambiguity in the first place.
const FORM_PIN_SEPARATOR = '\u0000form:';

function encodeFormPin(name: string, formIndex: number | undefined): string {
  return formIndex !== undefined ? `${name}${FORM_PIN_SEPARATOR}${formIndex}` : name;
}

function decodeFormPin(target: string): { name: string; formIndex?: number } {
  const idx = target.indexOf(FORM_PIN_SEPARATOR);
  if (idx === -1) return { name: target };
  return {
    name: target.slice(0, idx),
    formIndex: Number(target.slice(idx + FORM_PIN_SEPARATOR.length)),
  };
}

// STAGE 1 — action-capability filtering, done before ANY scoring: a fill
// step can only ever be matched against genuinely fillable controls
// (inputs — role textbox/searchbox/spinbutton, see page-crawler.ts's
// FILL_ROLES), a click/submit step only against clickable ones (buttons/
// links). A page's own buttons/links are never even constructed into
// candidates for a fill target, so a same-named button can't win a fill
// resolution by score — it's structurally never in the running.
function elementPool(step: RawStep, pages: PageMap[]): ElementCandidate[] {
  return pages.flatMap((page) => {
    const source =
      step.action === 'fill'
        ? page.inputs
        : step.action === 'select'
          ? page.selects
          : step.action === 'check'
            ? page.checkboxes
            : [...page.buttons, ...page.links];
    return source.map((element) => ({ element, page }));
  });
}

/** Matches the size of the other contextual bonus already in this file (findNavigationEvidence's `30 +`). */
const SAME_PAGE_CONTEXT_BONUS = 30;

function describeValue(rawValue: string | undefined): string {
  if (rawValue === '{{date:start}}') return 'startDate';
  if (rawValue === '{{date:end}}') return 'endDate';
  return `'${rawValue}'`;
}

function scoreElements(
  step: RawStep,
  pool: ElementCandidate[],
  contextPage: PageMap | undefined,
  startPage: PageMap | undefined,
): ScoredCandidate<ElementCandidate>[] {
  const isSubmitMarker = step.action === 'click' && step.target === 'submit';
  const pinned = !isSubmitMarker && step.target ? decodeFormPin(step.target) : undefined;
  const target = isSubmitMarker ? undefined : pinned?.name;
  const results: ScoredCandidate<ElementCandidate>[] = [];

  for (const candidate of pool) {
    const el = candidate.element;
    let score = 0;
    const reasons: string[] = [];

    // A human's earlier disambiguation choice, re-parsed back in — pins
    // not just a name but WHICH form-scoped occurrence, so this is an
    // exact, deterministic match, never re-scored against its own sibling
    // candidates (which share the identical name and would otherwise tie
    // again — see FORM_PIN_SEPARATOR above for why this is necessary).
    if (pinned?.formIndex !== undefined) {
      if (el.name === pinned.name && el.formIndex === pinned.formIndex) {
        results.push({
          item: candidate,
          score: 1000,
          reasons: [
            `the confirmed choice — "${el.name}" in the "${el.formLabel ?? `form ${el.formIndex + 1}`}" form`,
          ],
        });
      }
      continue;
    }

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

    if (score > 0 && contextPage && candidate.page === contextPage) {
      score += SAME_PAGE_CONTEXT_BONUS;
      reasons.push(
        `on the same page ("${contextPage.pageName}") as the preceding step's resolved element`,
      );
    } else if (score > 0 && !contextPage && startPage && candidate.page === startPage) {
      // Only when there's no REAL preceding-step page yet — a genuinely
      // resolved contextPage is always the stronger, more specific signal.
      score += SAME_PAGE_CONTEXT_BONUS;
      reasons.push(
        `on the application's configured starting page ("${startPage.pageName}") — where this step's action actually begins`,
      );
    }

    if (score > 0) results.push({ item: candidate, score, reasons });
  }

  return results;
}

interface ElementOutcome {
  mapping: StepMapping;
  chosenPage?: PageMap;
  /**
   * Set only when the resolved element is a real navigation link (role
   * "link", a captured `href`) — the pathname it points to. A click on a
   * LINK is a real page transition, unlike a click on a button (which
   * typically acts in place, e.g. a form submit) — see the main loop in
   * mapRequirementToUI, which resolves this against `map.pages` to correct
   * `currentPage` to the link's actual DESTINATION, not merely the page
   * the link itself was found on. Without this, "Click Add User" (a plain
   * navigational link) would leave subsequent fill/select steps scoped to
   * the ORIGIN page instead of the page the click actually lands on — a
   * generic bug that hits any workflow reaching a new page via an
   * ordinary link click rather than an explicit "Open X" sentence.
   */
  linkHref?: string;
}

function finalizeElement(
  step: RawStep,
  scored: ScoredCandidate<ElementCandidate>[],
  contextPage: PageMap | undefined,
): ElementOutcome {
  const actionLabel =
    step.action === 'fill'
      ? 'fillable'
      : step.action === 'select'
        ? 'selectable'
        : step.action === 'check'
          ? 'checkable'
          : 'clickable';
  const targetLabel =
    step.action === 'click' && step.target === 'submit' ? 'a submit control' : `"${step.target}"`;
  const ranked = rankCandidates(scored);
  const diagnostics = toCandidates(
    ranked,
    (c) => c.element.name,
    (c) => ({
      pageName: c.page.pageName,
      pageUrl: c.page.url,
      samePage: contextPage ? c.page === contextPage : undefined,
      elementType: humanElementType(c.element.role),
      formLabel: c.element.formLabel,
    }),
    (c) => encodeFormPin(c.element.name, c.element.formIndex),
  );

  if (ranked.length === 0) {
    return {
      mapping: {
        step,
        confidence: 'LOW',
        unmapped: { reason: `No discovered element provides any evidence for ${targetLabel}.` },
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
          reason: `No discovered element confidently matches ${targetLabel}. Best candidate: "${top.item.element.name}" (score ${top.score}: ${top.reasons.join('; ')}).`,
        },
        diagnostics,
      },
    };
  }

  if (confidence === 'MEDIUM') {
    return {
      mapping: { step, confidence, ambiguous: { candidates: diagnostics }, diagnostics },
    };
  }

  const el = top.item.element;
  const verified = el.verified;
  if (!verified) {
    return {
      mapping: {
        step,
        confidence: 'LOW',
        unmapped: {
          reason: `"${el.name}" scored as the best match for ${targetLabel} but is not currently verified as uniquely ${actionLabel}.`,
        },
        diagnostics,
      },
    };
  }

  diagnostics[0].selected = true;
  const kind =
    step.action === 'fill'
      ? 'fill'
      : step.action === 'select'
        ? 'select'
        : step.action === 'check'
          ? 'check'
          : 'click';
  const description =
    step.action === 'fill'
      ? `ui.fill('${el.name}', ${describeValue(step.value)})`
      : step.action === 'select'
        ? `ui.selectOption('${el.name}', ${describeValue(step.value)})`
        : step.action === 'check'
          ? `ui.check('${el.name}')`
          : `ui.click('${el.name}')`;
  return {
    mapping: {
      step,
      confidence: 'HIGH',
      resolved: {
        kind,
        description,
        strategy: verified.strategy,
        confidence: verified.confidence,
        resolvedLocator: verified.resolvedLocator,
        detail: el.name,
        formIndex: el.formIndex,
      },
      diagnostics,
    },
    chosenPage: top.item.page,
    linkHref: el.role === 'link' ? el.href : undefined,
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
  // The page a generated test's own prepended page.goto(app.startPath)
  // actually lands on (see code-generator.ts's generateSpecFile) — used
  // ONLY as a scoring bonus for a fill/click step with no real preceding-
  // step context yet (see scoreElements above). `hasApplication` guards a
  // synthetic/unregistered application id (e.g. a test fixture) — no
  // startPath assumption is made for those, same as before this existed.
  const startPage = hasApplication(application)
    ? map.pages.find((p) => p.path === (getApplication(application).startPath ?? '/'))
    : undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.action === 'login') {
      mappings.push(mapLogin(application, step, map));
      continue;
    }
    if (step.action === 'verify') {
      mappings.push(mapVerify(step, currentPage, mostRecentFillValue(steps, i)));
      continue;
    }

    if (step.action === 'navigate') {
      const target = step.target ?? '';
      const outcome = finalizeNavigate(step, target, scorePages(target, map.pages));
      mappings.push(outcome.mapping);
      if (outcome.chosenPage) currentPage = outcome.chosenPage;
      continue;
    }

    // fill / click — page/context filtering happens BEFORE semantic name
    // scoring ever gets a chance to matter, not as an additive bonus after
    // the fact: the pool is scoped to `currentPage` once one is known (set
    // by a navigate step, or carried forward from whichever page the
    // PRECEDING fill/click step's own element actually came from), or —
    // for the very first fill/click step, with no real preceding-step page
    // yet — to the application's own configured start page (`startPage`).
    // As long as that primary page offers ANY evidence at all, it wins
    // outright: an exact-string match on some unrelated page (a help/404/
    // settings page's own irrelevant "Search" control, discovered purely
    // because the crawler happened to follow a footer link there) must
    // never outscore the actual page this workflow runs on, which is
    // exactly the reported defect (5 candidates from 5 mostly-irrelevant
    // pages for a step that only ever executes on ONE specific page). Only
    // when that primary page has genuinely NOTHING matching does the
    // search widen to every discovered page — and only for the first step;
    // a REAL currentPage's own scope is never relaxed (see the existing
    // "scopes fill/click lookups to the most recently navigated page"
    // contract, unchanged).
    const primaryPage = currentPage ?? startPage;
    let pool = elementPool(step, primaryPage ? [primaryPage] : map.pages);
    let scored = scoreElements(step, pool, currentPage, startPage);
    if (scored.length === 0 && !currentPage && startPage) {
      pool = elementPool(step, map.pages);
      scored = scoreElements(step, pool, currentPage, startPage);
    }

    const outcome = finalizeElement(step, scored, currentPage);
    mappings.push(outcome.mapping);
    // A click on a real navigation LINK is a genuine page transition — the
    // context a NEXT step should inherit is the link's DESTINATION, not
    // merely the page the link itself lived on (see ElementOutcome.linkHref
    // above). Falls back to the origin page when the href doesn't match
    // any discovered page (e.g. an external link, or a page discovery
    // never reached) — never a guess, just no context change in that case.
    const destinationPage = outcome.linkHref
      ? map.pages.find((p) => p.path === outcome.linkHref)
      : undefined;
    if (destinationPage) currentPage = destinationPage;
    else if (outcome.chosenPage) currentPage = outcome.chosenPage;
  }

  return mappings;
}
