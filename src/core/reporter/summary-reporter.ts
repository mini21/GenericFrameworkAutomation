import type { Reporter, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger/logger';
import { CoverageResult } from '../coverage/coverage-types';

/**
 * Runs once in the main process (not per worker, so it's inherently
 * parallel-safe) alongside the native HTML/JUnit/Allure reporters.
 * Routes failures through the centralized Winston logger — the thing
 * native reporters don't do — so failures show up in logs/run.log
 * alongside everything else, not only in report artifacts.
 */
export default class SummaryReporter implements Reporter {
  private readonly failed: string[] = [];
  private total = 0;
  private passed = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    this.total += 1;
    if (result.status === 'passed') {
      this.passed += 1;
    }
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.failed.push(`${test.titlePath().slice(1).join(' > ')} (${result.status})`);
      logger.error(`Test failed: ${test.title}`, {
        file: test.location.file,
        error: result.error?.message,
      });
    }
  }

  onEnd(result: FullResult): void {
    const executionPassRate =
      this.total > 0 ? Math.round((this.passed / this.total) * 1000) / 10 : 0;
    logger.info(`Run finished: ${result.status}`, {
      failedCount: this.failed.length,
      // Execution pass rate: did the tests that ran, pass? Distinct from
      // requirement coverage below — never conflate the two.
      executionPassRate: `${executionPassRate}% (${this.passed}/${this.total})`,
    });
    if (this.failed.length > 0) {
      logger.warn('Failed tests', { tests: this.failed });
    }

    this.logCoverageIfAvailable();
  }

  private logCoverageIfAvailable(): void {
    // Application-scoped report (reports/coverage/<app>/coverage.json) takes
    // precedence when GAP_APPLICATION is set — falls back to the
    // framework-level report (reports/coverage/coverage.json) otherwise.
    const application = process.env.GAP_APPLICATION;
    const coveragePath = application
      ? path.resolve(process.cwd(), 'reports', 'coverage', application, 'coverage.json')
      : path.resolve(process.cwd(), 'reports', 'coverage', 'coverage.json');
    if (!fs.existsSync(coveragePath)) return;

    try {
      const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8')) as CoverageResult;
      // Requirement coverage: does a requirement have ANY automated test at
      // all, regardless of whether it passed. A separate concern from
      // execution pass rate above, on purpose — see docs/COVERAGE.md.
      // coverageGeneratedAt exposes staleness: this file is only produced
      // by the `coverage` project (npm run coverage:report), so if this
      // run didn't include that project, the numbers are from an earlier run.
      logger.info('Requirement coverage (NOT execution pass rate)', {
        application: application ?? '(framework-level)',
        requirementCoverage: `${coverage.coveragePercent}% (${coverage.coveredRequirements}/${coverage.totalRequirements})`,
        criticalRequirementCoverage: `${coverage.criticalCoveragePercent}% (${coverage.criticalCovered}/${coverage.criticalTotal})`,
        uncoveredRequirements: coverage.uncoveredRequirements,
        coverageGeneratedAt: coverage.generatedAt,
      });
    } catch {
      // Coverage report exists but is unreadable/stale — not fatal to the
      // run, just skip surfacing it this time.
    }
  }
}
