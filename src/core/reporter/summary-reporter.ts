import type { Reporter, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { logger } from '../logger/logger';

/**
 * Runs once in the main process (not per worker, so it's inherently
 * parallel-safe) alongside the native HTML/JUnit/Allure reporters.
 * Routes failures through the centralized Winston logger — the thing
 * native reporters don't do — so failures show up in logs/run.log
 * alongside everything else, not only in report artifacts.
 */
export default class SummaryReporter implements Reporter {
  private readonly failed: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.failed.push(`${test.titlePath().slice(1).join(' > ')} (${result.status})`);
      logger.error(`Test failed: ${test.title}`, {
        file: test.location.file,
        error: result.error?.message,
      });
    }
  }

  onEnd(result: FullResult): void {
    logger.info(`Run finished: ${result.status}`, { failedCount: this.failed.length });
    if (this.failed.length > 0) {
      logger.warn('Failed tests', { tests: this.failed });
    }
  }
}
