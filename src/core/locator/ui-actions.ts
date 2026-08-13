import { Locator, Page, TestInfo } from '@playwright/test';
import { LocatorResolver } from './locator-resolver';
import { LocatorIntent, LocatorResolution, LocatorResolutionError } from './locator-types';
import { logger } from '../logger/logger';

type Action = 'click' | 'fill';

/**
 * QA-facing Locator Intelligence API: `ui.click('Login')`,
 * `ui.fill('Username', 'john')`. Wraps LocatorResolver with logging and
 * report attachment — never a custom locator engine, every candidate
 * locator is a native Playwright getBy-family or locator() call.
 */
export class UiActions {
  private readonly resolver: LocatorResolver;

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
  ) {
    this.resolver = new LocatorResolver(page);
  }

  async click(target: string | LocatorIntent): Promise<void> {
    const { locator } = await this.resolveAndReport(target, 'click');
    await locator.click();
  }

  async fill(target: string | LocatorIntent, value: string): Promise<void> {
    const { locator } = await this.resolveAndReport(target, 'fill');
    await locator.fill(value);
  }

  /** Resolves without acting — for callers who need the Locator itself (check, selectOption, assertions, ...). */
  async locate(target: string | LocatorIntent, action: Action = 'click'): Promise<Locator> {
    const { locator } = await this.resolveAndReport(target, action);
    return locator;
  }

  private async resolveAndReport(
    target: string | LocatorIntent,
    action: Action,
  ): Promise<{ locator: Locator; resolution: LocatorResolution }> {
    const intent: LocatorIntent = typeof target === 'string' ? { name: target } : target;

    let outcome: Awaited<ReturnType<LocatorResolver['resolve']>>;
    try {
      outcome = await this.resolver.resolve(intent, action);
    } catch (error) {
      if (error instanceof LocatorResolutionError) {
        logger.error(`Locator resolution failed for "${intent.name}"`, {
          test: this.testInfo.title,
          attempts: error.attempts,
        });
      }
      throw error;
    }

    const resolution: LocatorResolution = {
      ...outcome.resolution,
      testName: this.testInfo.title,
      timestamp: new Date().toISOString(),
    };

    if (resolution.healed || resolution.confidence !== 'HIGH') {
      // Never hide healing/non-HIGH matches: always logged, and always
      // attached to the test report (visible in HTML + Allure, since
      // testInfo.attach() is a native Playwright reporting mechanism both
      // reporters already understand — no custom Allure API calls needed).
      logger.warn(
        resolution.healed ? 'Locator healed' : 'Locator resolved with reduced confidence',
        {
          ...resolution,
        },
      );

      const report = [
        resolution.healed ? 'LOCATOR HEALED' : 'LOCATOR RESOLVED (reduced confidence)',
        '',
        `Test: ${resolution.testName}`,
        resolution.originalLocator ? `Original: ${resolution.originalLocator}` : undefined,
        `Resolved: ${resolution.resolvedLocator}`,
        `Strategy: ${resolution.strategy}`,
        `Confidence: ${resolution.confidence}`,
        `Timestamp: ${resolution.timestamp}`,
      ]
        .filter((line) => line !== undefined)
        .join('\n');

      await this.testInfo.attach(
        `locator-healing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        {
          body: report,
          contentType: 'text/plain',
        },
      );
    } else {
      logger.debug('Locator resolved', { ...resolution });
    }

    return { locator: outcome.locator, resolution };
  }
}
