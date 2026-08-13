import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { loadStaticData } from '../../test-data/utils/static-data.util';
import { getExecutionContext } from '../../src/core/execution/execution-context';
import { discoverTests } from '../../src/core/coverage/test-discovery';
import { calculateCoverage } from '../../src/core/coverage/coverage-calculator';
import { formatTextReport } from '../../src/core/coverage/coverage-report';
import { RequirementsFile } from '../../src/core/coverage/coverage-types';
import { TAGS } from '../../src/core/constants';

/**
 * Same calculator/report logic either way — only the requirements source
 * differs: an application's own requirements.json when GAP_APPLICATION is
 * set (by the GAP CLI), the framework-level one otherwise. No duplicated
 * coverage logic per application.
 */
function loadRequirements(application: string | undefined): RequirementsFile {
  if (!application) {
    return loadStaticData<RequirementsFile>('requirements.json');
  }
  const filePath = path.resolve(
    process.cwd(),
    'applications',
    application,
    'requirements',
    'requirements.json',
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`No requirements.json found for application "${application}" at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RequirementsFile;
}

test.describe(`Test Coverage ${TAGS.SMOKE}`, () => {
  test('generates and validates the requirement coverage report', async ({}, testInfo) => {
    const { application } = getExecutionContext();
    const { requirements } = loadRequirements(application);
    const discovered = discoverTests();

    const result = calculateCoverage(requirements, discovered);
    const textReport = formatTextReport(result, application);

    const outDir = application
      ? path.resolve(process.cwd(), 'reports', 'coverage', application)
      : path.resolve(process.cwd(), 'reports', 'coverage');
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
