import { listApplications, ApplicationRegistry, BrowserName } from '../config/application-registry';
import { TestType } from '../execution/execution-manifest';
import { CliOverrides } from '../execution/execution-resolver';
import {
  ENVIRONMENT_KEYWORDS,
  TEST_TYPE_KEYWORDS,
  BROWSER_KEYWORDS,
  ALL_BROWSERS_PHRASES,
  textContainsWord,
  matchKeywords,
} from './vocabulary';
import { Ambiguity, AmbiguityField, ParseResult } from './intent-types';

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

// Words that can legitimately sit right before "module" without naming one
// ("the module", "smoke module tests") — excluded from the unrecognized-
// module-name fallback below so they don't get misread as a module.
const MODULE_MENTION_STOPWORDS = new Set([
  'the',
  'this',
  'that',
  'a',
  'an',
  'test',
  'tests',
  'smoke',
  'regression',
  'sanity',
  'functional',
]);

function ambiguity(
  field: AmbiguityField,
  question: string,
  values: string[],
  labels?: string[],
): Ambiguity {
  return {
    field,
    question,
    options: values.map((value, i) => ({ value, label: labels ? labels[i] : value })),
  };
}

function matchApplications(text: string, registry: ApplicationRegistry): string[] {
  const lower = text.toLowerCase();
  return Object.keys(registry).filter(
    (id) => textContainsWord(text, id) || lower.includes(registry[id].name.toLowerCase()),
  );
}

function findModuleHits(
  text: string,
  registry: ApplicationRegistry,
  candidateAppIds: string[],
): { app: string; module: string }[] {
  const hits: { app: string; module: string }[] = [];
  for (const appId of candidateAppIds) {
    for (const module of registry[appId].modules) {
      if (textContainsWord(text, module)) {
        hits.push({ app: appId, module });
      }
    }
  }
  return hits;
}

function applicationLabels(ids: string[], registry: ApplicationRegistry): string[] {
  return ids.map((id) => `${registry[id].name} (${id})`);
}

/**
 * Deterministic natural-language parser — plain keyword/pattern matching
 * against the application registry and a fixed vocabulary, no LLM. Never
 * guesses when more than one candidate matches: it reports an ambiguity
 * instead, leaving the caller (the GAP REPL) to ask the user.
 *
 * `registry` defaults to the real application registry; tests pass a
 * synthetic one to exercise multi-application ambiguity without mutating
 * `config/applications.json`.
 */
export function parseIntent(
  text: string,
  registry: ApplicationRegistry = listApplications(),
): ParseResult {
  const allAppIds = Object.keys(registry);
  const ambiguities: Ambiguity[] = [];

  // --- Application -----------------------------------------------------
  const explicitAppMatches = matchApplications(text, registry);
  let application: string | undefined;
  if (explicitAppMatches.length === 1) {
    application = explicitAppMatches[0];
  } else if (explicitAppMatches.length > 1) {
    ambiguities.push(
      ambiguity(
        'application',
        'I found multiple possible applications. Which application should I use?',
        explicitAppMatches,
        applicationLabels(explicitAppMatches, registry),
      ),
    );
  } else {
    // No explicit mention — narrow via module name, then fall back to "only one app exists".
    const appsFromModule = unique(findModuleHits(text, registry, allAppIds).map((h) => h.app));
    if (appsFromModule.length === 1) {
      application = appsFromModule[0];
    } else if (appsFromModule.length > 1) {
      ambiguities.push(
        ambiguity(
          'application',
          'I found multiple possible applications. Which application should I use?',
          appsFromModule,
          applicationLabels(appsFromModule, registry),
        ),
      );
    } else if (allAppIds.length === 1) {
      application = allAppIds[0];
    } else if (allAppIds.length > 1) {
      ambiguities.push(
        ambiguity(
          'application',
          'I found multiple possible applications. Which application should I use?',
          allAppIds,
          applicationLabels(allAppIds, registry),
        ),
      );
    }
  }

  // --- Module ------------------------------------------------------------
  const moduleScopeApps = application
    ? [application]
    : explicitAppMatches.length > 0
      ? explicitAppMatches
      : allAppIds;
  const distinctModules = unique(
    findModuleHits(text, registry, moduleScopeApps).map((h) => h.module),
  );
  let module: string | undefined;
  if (distinctModules.length === 1) {
    module = distinctModules[0];
  } else if (distinctModules.length > 1) {
    ambiguities.push(
      ambiguity(
        'module',
        'I found multiple possible modules. Which module should I use?',
        distinctModules,
      ),
    );
  } else {
    // No registered module name matched. If the text still names something
    // as "<word> module" (e.g. "Payments module"), don't silently drop it
    // and run every module — pass the unrecognized name through so
    // `validateIntent` reports "Application X has no module Y" instead of
    // quietly widening the run to everything.
    const nearModuleMatch = text.match(/\b([A-Za-z][\w-]*)\s+module\b/i);
    const candidate = nearModuleMatch?.[1]?.toLowerCase();
    if (candidate && !MODULE_MENTION_STOPWORDS.has(candidate)) {
      module = candidate;
    }
  }

  // --- Environment ---------------------------------------------------
  const envMatches = matchKeywords(text, ENVIRONMENT_KEYWORDS);
  let environment: string | undefined;
  if (envMatches.length === 1) {
    environment = envMatches[0];
  } else if (envMatches.length > 1) {
    ambiguities.push(
      ambiguity(
        'environment',
        'I found multiple possible environments. Which environment should I use?',
        envMatches,
      ),
    );
  }

  // --- Test type -----------------------------------------------------
  const typeMatches = matchKeywords(text, TEST_TYPE_KEYWORDS);
  let type: TestType | undefined;
  if (typeMatches.length === 1) {
    type = typeMatches[0];
  } else if (typeMatches.length > 1) {
    ambiguities.push(
      ambiguity(
        'type',
        'I found multiple possible test types. Which test type should I use?',
        typeMatches,
      ),
    );
  }

  // --- Browser(s) — multiple explicit mentions is a valid multi-browser
  // request, not an ambiguity to resolve; the confirmation step is the
  // safety net if that reading is wrong. ---------------------------------
  let browsers: BrowserName[] | undefined;
  if (ALL_BROWSERS_PHRASES.some((phrase) => text.toLowerCase().includes(phrase))) {
    browsers = ['all'] as unknown as BrowserName[];
  } else {
    const browserMatches = unique(
      Object.keys(BROWSER_KEYWORDS)
        .filter((keyword) => textContainsWord(text, keyword))
        .map((keyword) => BROWSER_KEYWORDS[keyword]),
    );
    if (browserMatches.length > 0) browsers = browserMatches;
  }

  // --- Tags — explicit @tag tokens only, no free-text guessing. -------
  const tagMatches = text.match(/@[\w.-]+/g);
  const tags = tagMatches ? unique(tagMatches) : undefined;

  const intent: Partial<CliOverrides> = { application, environment, module, type, browsers, tags };
  return { intent, ambiguities };
}
