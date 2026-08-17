import { listApplications, ApplicationRegistry } from '../config/application-registry';
import { TestType } from '../execution/execution-manifest';
import { CliOverrides } from '../execution/execution-resolver';
import {
  ENVIRONMENT_KEYWORDS,
  TEST_TYPE_KEYWORDS,
  BROWSER_KEYWORDS,
  findByKeyword,
} from './vocabulary';

export interface StructuredParseResult {
  intent: Partial<CliOverrides>;
  errors: string[];
}

type Field = 'application' | 'environment' | 'module' | 'type' | 'browser' | 'tag';

const FIELD_ALIASES: Record<string, Field> = {
  application: 'application',
  app: 'application',
  environment: 'environment',
  env: 'environment',
  module: 'module',
  type: 'type',
  testtype: 'type',
  'test type': 'type',
  browser: 'browser',
  browsers: 'browser',
  tag: 'tag',
  tags: 'tag',
};

/**
 * Parses "field: value" lines (Phase 2 — the alternative to natural
 * language). Every value is checked against the same registry/vocabulary
 * the natural-language parser uses, so both produce values `resolveExecution`
 * accepts. Fields are already labeled here, so unlike the NL parser this
 * never needs to report an ambiguity — an unrecognized value is a
 * straight error instead.
 */
export function parseStructuredInput(
  lines: string[],
  registry: ApplicationRegistry = listApplications(),
): StructuredParseResult {
  const intent: Partial<CliOverrides> = {};
  const errors: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      errors.push(`Could not understand line "${line}" — expected "field: value".`);
      continue;
    }

    const rawKey = line.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const field = FIELD_ALIASES[rawKey];
    if (!field) {
      errors.push(
        `Unknown field "${rawKey}". Recognized fields: application, environment, module, type, browser, tags.`,
      );
      continue;
    }
    if (!rawValue) {
      errors.push(`Field "${rawKey}" has no value.`);
      continue;
    }

    switch (field) {
      case 'application': {
        const appId = Object.keys(registry).find(
          (id) =>
            id.toLowerCase() === rawValue.toLowerCase() ||
            registry[id].name.toLowerCase() === rawValue.toLowerCase(),
        );
        if (!appId) {
          errors.push(
            `Unknown application "${rawValue}". Known applications: ` +
              `${Object.keys(registry).join(', ') || '(none registered)'}.`,
          );
          break;
        }
        intent.application = appId;
        break;
      }
      case 'environment': {
        const env = findByKeyword(rawValue, ENVIRONMENT_KEYWORDS);
        if (!env) {
          errors.push(
            `Unknown environment "${rawValue}". Supported: ${Object.keys(ENVIRONMENT_KEYWORDS).join(', ')}.`,
          );
          break;
        }
        intent.environment = env;
        break;
      }
      case 'module': {
        intent.module = rawValue.toLowerCase();
        break;
      }
      case 'type': {
        const type = findByKeyword(rawValue, TEST_TYPE_KEYWORDS) as TestType | undefined;
        if (!type) {
          errors.push(
            `Unknown test type "${rawValue}". Supported: ${Object.keys(TEST_TYPE_KEYWORDS).join(', ')}.`,
          );
          break;
        }
        intent.type = type;
        break;
      }
      case 'browser': {
        const tokens = rawValue
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        const browsers: string[] = [];
        for (const token of tokens) {
          const lower = token.toLowerCase();
          if (lower === 'all') {
            browsers.push('all');
            continue;
          }
          const mapped = BROWSER_KEYWORDS[lower];
          if (!mapped) {
            errors.push(
              `Unknown browser "${token}". Supported: chrome, firefox, safari, webkit, chromium, all.`,
            );
            continue;
          }
          browsers.push(mapped);
        }
        if (browsers.length > 0) {
          intent.browsers = Array.from(new Set(browsers)) as CliOverrides['browsers'];
        }
        break;
      }
      case 'tag': {
        intent.tags = rawValue
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        break;
      }
    }
  }

  return { intent, errors };
}
