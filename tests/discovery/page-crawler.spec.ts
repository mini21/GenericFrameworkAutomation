import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapPage } from '../../src/core/discovery/page-crawler';
import { TAGS } from '../../src/core/constants';

const FIXTURE_HTML = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'discovery-page.html'),
  'utf-8',
);

test.beforeEach(async ({ page }) => {
  await page.setContent(FIXTURE_HTML);
});

test.describe(`Application Discovery — page mapping ${TAGS.SMOKE}`, () => {
  test('categorizes elements by ARIA role and verifies click/fill-shaped ones via LocatorResolver', async ({
    page,
  }) => {
    const map = await mapPage(page);

    expect(map.headings).toEqual(['Employee Portal']);

    expect(map.buttons.map((b) => b.name)).toContain('Submit');
    const submit = map.buttons.find((b) => b.name === 'Submit');
    expect(submit?.verified).toEqual({
      strategy: 'role',
      confidence: 'HIGH',
      resolvedLocator: 'getByRole("button", { name: "Submit" })',
    });

    expect(map.links.map((l) => l.name).sort()).toEqual(['Dashboard', 'Reports']);

    expect(map.inputs.map((i) => i.name).sort()).toEqual(['Search', 'Username']);
    const username = map.inputs.find((i) => i.name === 'Username');
    expect(username?.verified?.confidence).toBe('HIGH');

    expect(map.selects.map((s) => s.name)).toEqual(['Country']);
    // Selects ARE now run through LocatorResolver, via the dedicated
    // 'select' action (see locator-resolver.ts's SELECT_ROLES) — a real
    // resolvable capability, not just a discovered-but-inert entry.
    expect(map.selects[0].verified).toEqual({
      strategy: 'role',
      confidence: 'HIGH',
      resolvedLocator: 'getByRole("combobox", { name: "Country" })',
    });

    expect(map.checkboxes.map((c) => c.name)).toEqual(['I agree']);
  });

  test('counts structural landmarks (table/form/navigation) even when unnamed', async ({
    page,
  }) => {
    const map = await mapPage(page);

    expect(map.tables).toBe(1);
    expect(map.forms).toBe(1); // this fixture's <form> has an aria-label, unlike HRMS's
    expect(map.navigation).toBe(1);
  });

  test('reports data-testid attributes present on the page', async ({ page }) => {
    const map = await mapPage(page);
    expect(map.testIds).toContain('profile-widget');
  });

  test('an ambiguous (duplicate-name) element is reported without a verified block', async ({
    page,
  }) => {
    const map = await mapPage(page);
    const duplicate = map.buttons.find((b) => b.name === 'Duplicate');
    expect(duplicate).toBeDefined();
    expect(duplicate?.verified).toBeUndefined();
  });

  test('pageName falls back to the document title', async ({ page }) => {
    const map = await mapPage(page);
    expect(map.pageName).toBe('Discovery test fixture');
    expect(map.title).toBe('Discovery test fixture');
  });
});
