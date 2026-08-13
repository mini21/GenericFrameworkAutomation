import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { loadStaticData } from '../../test-data/utils/static-data.util';
import { discoverTests } from '../../src/core/coverage/test-discovery';
import { calculateCoverage } from '../../src/core/coverage/coverage-calculator';
import { formatTextReport } from '../../src/core/coverage/coverage-report';
import { RequirementsFile } from '../../src/core/coverage/coverage-types';
import { TAGS } from '../../src/core/constants';

// Generates the requirement-coverage report from test-data/static/requirements.json
// cross-referenced against every test Playwright can discover (see
// docs/COVERAGE.md). Writes human + machine-readable reports to
// reports/coverage/ and attaches both to this test's result for native
// Allure/HTML visibility — no bespoke Allure API calls needed.
test.describe(`Test Coverage ${TAGS.SMOKE}`, () => {
  test('generates and validates the requirement coverage report', async ({}, testInfo) => {
    const { requirements } = loadStaticData<RequirementsFile>('requirements.json');
    const discovered = discoverTests();

    const result = calculateCoverage(requirements, discovered);
    const textReport = formatTextReport(result);

    const outDir = path.resolve(process.cwd(), 'reports', 'coverage');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'coverage.txt'), textReport, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(result, null, 2), 'utf-8');

    process.stdout.write(`\n${textReport}\n\n`);

    await testInfo.attach('coverage-report.txt', { body: textReport, contentType: 'text/plain' });
    await testInfo.attach('coverage-report.json', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });

    // Enforceable gate: every Critical requirement must have at least one
    // automated test. Not a blanket 100%-coverage requirement — that would
    // be unrealistic for most real projects — just the Critical tier.
    expect(
      result.criticalCoveragePercent,
      `Critical requirement coverage is below 100%. Uncovered: ${result.uncoveredRequirements.join(', ')}`,
    ).toBe(100);
  });
});
