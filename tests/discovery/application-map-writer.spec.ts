import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import {
  writeApplicationMap,
  formatSummary,
} from '../../src/core/discovery/application-map-writer';
import { ApplicationMap } from '../../src/core/discovery/discovery-types';
import { TAGS } from '../../src/core/constants';

const TEST_APPLICATION = 'discovery-writer-test-fixture';

const SAMPLE_MAP: ApplicationMap = {
  application: TEST_APPLICATION,
  baseUrl: 'http://localhost:4100',
  generatedAt: '2026-01-01T00:00:00.000Z',
  pages: [
    {
      path: '/login.html',
      url: 'http://localhost:4100/login.html',
      title: 'HRMS Login',
      pageName: 'HRMS Login',
      headings: ['Employee Leave Management'],
      buttons: [{ role: 'button', name: 'Login' }],
      links: [],
      inputs: [
        { role: 'textbox', name: 'Username' },
        { role: 'textbox', name: 'Password' },
      ],
      selects: [],
      checkboxes: [],
      tables: 0,
      forms: 0,
      navigation: 0,
      testIds: [],
      confirmationRegions: [],
      ariaSnapshot: '- button "Login"',
    },
  ],
  errors: [],
};

test.describe(`Application Discovery — output ${TAGS.SMOKE}`, () => {
  test.afterEach(() => {
    fs.rmSync(path.resolve(process.cwd(), 'applications', TEST_APPLICATION), {
      recursive: true,
      force: true,
    });
  });

  test('writes applications/<id>/discovery/application-map.json', () => {
    const filePath = writeApplicationMap(SAMPLE_MAP);

    expect(filePath).toBe(
      path.resolve(
        process.cwd(),
        'applications',
        TEST_APPLICATION,
        'discovery',
        'application-map.json',
      ),
    );
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ApplicationMap;
    expect(written).toEqual(SAMPLE_MAP);
  });

  test('formatSummary renders a QA-facing page/element digest matching the target example shape', () => {
    const summary = formatSummary(SAMPLE_MAP);

    expect(summary).toContain(`Application: ${TEST_APPLICATION}`);
    expect(summary).toContain('  HRMS Login');
    expect(summary).toContain('    - Username');
    expect(summary).toContain('    - Password');
    expect(summary).toContain('    - Login');
    expect(summary).toContain('1 page(s) mapped.');
  });

  test('formatSummary lists pages that failed to load', () => {
    const summary = formatSummary({
      ...SAMPLE_MAP,
      errors: [
        { url: 'http://localhost:4100/broken.html', message: 'net::ERR_CONNECTION_REFUSED' },
      ],
    });

    expect(summary).toContain('Pages that failed to load:');
    expect(summary).toContain('http://localhost:4100/broken.html: net::ERR_CONNECTION_REFUSED');
  });
});
