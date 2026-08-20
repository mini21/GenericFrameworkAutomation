import { Locator, Page } from '@playwright/test';
import {
  LocatorIntent,
  LocatorResolution,
  LocatorResolutionError,
  LocatorStrategy,
  STRATEGY_CONFIDENCE,
} from './locator-types';

type Action = 'click' | 'fill' | 'select';
type TryResult = 'unique' | 'not found' | 'ambiguous' | 'not usable';

interface Candidate {
  strategy: LocatorStrategy;
  locator: Locator;
  description: string;
}

// Deterministic, rule-based role guesses per action — not ML, not DOM-similarity
// guessing. If neither guess fits a target element, add a `primary` testId/css
// so the chain doesn't need to rely on the role guess at all.
const CLICK_ROLES = ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab'] as const;
const FILL_ROLES = ['textbox', 'searchbox', 'spinbutton'] as const;
// A native <select> exposes as role "combobox" (single-select) or
// "listbox" (multi-select/size>1) in the accessibility tree — the same two
// roles page-crawler.ts's SELECT_ROLES already discovers by, so this action
// resolves against exactly what discovery already found, generically, for
// any application's dropdown/option control.
const SELECT_ROLES = ['combobox', 'listbox'] as const;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function describePrimary(primary: NonNullable<LocatorIntent['primary']>): string {
  if (primary.testId) return `testId="${primary.testId}"`;
  if (primary.css) return `css="${primary.css}"`;
  if (primary.xpath) return `xpath="${primary.xpath}"`;
  return 'primary';
}

async function isUsable(locator: Locator, action: Action): Promise<boolean> {
  try {
    if (!(await locator.isVisible())) return false;
    if (action === 'click') return await locator.isEnabled();
    if (action === 'fill') return (await locator.isEnabled()) && (await locator.isEditable());
    // 'select': a <select> is never "editable" in Playwright's sense (that
    // check is for text-input-shaped controls) — enabled + visible is the
    // real, generic precondition for selectOption() to succeed.
    if (action === 'select') return await locator.isEnabled();
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic locator resolution over Playwright's own recommended
 * locators — no AI/ML, no DOM-similarity guessing. Order: an optional
 * explicit primary, then role -> label -> placeholder -> text -> testId ->
 * css -> xpath. Every candidate is verified unique (count === 1) and usable
 * (visible + interactable for the requested action) before being accepted —
 * ambiguous matches are never resolved by picking the first element.
 */
export class LocatorResolver {
  constructor(private readonly page: Page) {}

  async resolve(
    intent: LocatorIntent,
    action: Action,
  ): Promise<{ locator: Locator; resolution: Omit<LocatorResolution, 'testName' | 'timestamp'> }> {
    const attempts: string[] = [];
    let originalLocator: string | undefined;
    const root: Page | Locator =
      intent.scope !== undefined
        ? this.page.locator('form').nth(intent.scope.formIndex)
        : this.page;

    if (intent.primary) {
      originalLocator = describePrimary(intent.primary);
      const primaryCandidate = this.buildPrimaryCandidate(root, intent.primary);
      const result = await this.tryCandidate(primaryCandidate, action);
      if (result === 'unique') {
        return {
          locator: primaryCandidate.locator,
          resolution: {
            originalLocator,
            resolvedLocator: primaryCandidate.description,
            strategy: 'primary',
            confidence: STRATEGY_CONFIDENCE.primary,
            healed: false,
          },
        };
      }
      attempts.push(`${primaryCandidate.description} -> ${result}`);
    }

    for (const candidate of this.buildChainCandidates(root, intent, action)) {
      const result = await this.tryCandidate(candidate, action);
      if (result === 'unique') {
        const confidence = STRATEGY_CONFIDENCE[candidate.strategy];
        if (confidence === 'LOW') {
          // xpath is the final fallback in the resolution order, but a LOW
          // confidence match is never acted on automatically — fail safely
          // rather than interact with an uncertain element.
          attempts.push(`${candidate.description} -> unique but LOW confidence, refusing to act`);
          continue;
        }
        return {
          locator: candidate.locator,
          resolution: {
            originalLocator,
            resolvedLocator: candidate.description,
            strategy: candidate.strategy,
            confidence,
            healed: Boolean(intent.primary),
          },
        };
      }
      attempts.push(`${candidate.description} -> ${result}`);
    }

    throw new LocatorResolutionError(
      `Could not resolve a unique, usable locator for "${intent.name}". Tried:\n${attempts.map((a) => `  - ${a}`).join('\n')}`,
      intent,
      attempts,
    );
  }

  private buildPrimaryCandidate(
    root: Page | Locator,
    primary: NonNullable<LocatorIntent['primary']>,
  ): Candidate {
    if (primary.testId) {
      return {
        strategy: 'primary',
        locator: root.getByTestId(primary.testId),
        description: `testId="${primary.testId}"`,
      };
    }
    if (primary.css) {
      return {
        strategy: 'primary',
        locator: root.locator(primary.css),
        description: `css="${primary.css}"`,
      };
    }
    return {
      strategy: 'primary',
      locator: root.locator(`xpath=${primary.xpath}`),
      description: `xpath="${primary.xpath}"`,
    };
  }

  private *buildChainCandidates(
    root: Page | Locator,
    intent: LocatorIntent,
    action: Action,
  ): Generator<Candidate> {
    const scopePrefix = intent.scope !== undefined ? `form[${intent.scope.formIndex}] ` : '';
    const roles = action === 'click' ? CLICK_ROLES : action === 'fill' ? FILL_ROLES : SELECT_ROLES;
    for (const role of roles) {
      yield {
        strategy: 'role',
        locator: root.getByRole(role, { name: intent.name }),
        description: `${scopePrefix}getByRole("${role}", { name: "${intent.name}" })`,
      };
    }
    yield {
      strategy: 'label',
      locator: root.getByLabel(intent.name),
      description: `${scopePrefix}getByLabel("${intent.name}")`,
    };
    yield {
      strategy: 'placeholder',
      locator: root.getByPlaceholder(intent.name),
      description: `${scopePrefix}getByPlaceholder("${intent.name}")`,
    };
    yield {
      strategy: 'text',
      locator: root.getByText(intent.name, { exact: true }),
      description: `${scopePrefix}getByText("${intent.name}", { exact: true })`,
    };
    yield {
      strategy: 'testid',
      locator: root.getByTestId(slugify(intent.name)),
      description: `${scopePrefix}getByTestId("${slugify(intent.name)}")`,
    };
    if (intent.fallback?.css) {
      yield {
        strategy: 'css',
        locator: root.locator(intent.fallback.css),
        description: `css="${intent.fallback.css}"`,
      };
    }
    if (intent.fallback?.xpath) {
      yield {
        strategy: 'xpath',
        locator: root.locator(`xpath=${intent.fallback.xpath}`),
        description: `xpath="${intent.fallback.xpath}"`,
      };
    }
  }

  private async tryCandidate(candidate: Candidate, action: Action): Promise<TryResult> {
    const count = await candidate.locator.count();
    if (count === 0) return 'not found';
    if (count > 1) return 'ambiguous';
    return (await isUsable(candidate.locator, action)) ? 'unique' : 'not usable';
  }
}
