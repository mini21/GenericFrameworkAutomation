import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { LocatorResolver } from '../../src/core/locator/locator-resolver';
import { LocatorResolutionError } from '../../src/core/locator/locator-types';
import { TAGS } from '../../src/core/constants';

const FIXTURE_HTML = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'locator-test-page.html'),
  'utf-8',
);

test.beforeEach(async ({ page }) => {
  await page.setContent(FIXTURE_HTML);
});

test.describe(`Locator Intelligence — resolution strategies ${TAGS.SMOKE}`, () => {
  test('resolves via role (HIGH confidence)', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    const { locator, resolution } = await resolver.resolve({ name: 'Login' }, 'click');

    expect(resolution.strategy).toBe('role');
    expect(resolution.confidence).toBe('HIGH');
    await expect(locator).toHaveText('Login');
  });

  test('resolves via label (HIGH confidence)', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    // A <select>'s implicit role (combobox) isn't one this resolver guesses
    // for click/fill, so role can't win here — isolates label specifically.
    const { locator, resolution } = await resolver.resolve({ name: 'Country' }, 'click');

    expect(resolution.strategy).toBe('label');
    expect(resolution.confidence).toBe('HIGH');
    await expect(locator).toHaveAttribute('id', 'country-select');
  });

  test('resolves via placeholder (MEDIUM confidence)', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    // A plain element with a `placeholder` attribute has no implicit
    // interactive role, so role/label can't match — isolates placeholder.
    const { resolution } = await resolver.resolve({ name: 'Search' }, 'click');

    expect(resolution.strategy).toBe('placeholder');
    expect(resolution.confidence).toBe('MEDIUM');
  });

  test('resolves via text (MEDIUM confidence)', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    const { resolution } = await resolver.resolve({ name: 'Welcome back' }, 'click');

    expect(resolution.strategy).toBe('text');
    expect(resolution.confidence).toBe('MEDIUM');
  });

  test('resolves via testId (HIGH confidence)', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    // "Profile" has no matching role/label/placeholder/text at all, so this
    // falls through to data-testid="profile" (slugify('Profile') === 'profile').
    const { resolution } = await resolver.resolve({ name: 'Profile' }, 'click');

    expect(resolution.strategy).toBe('testid');
    expect(resolution.confidence).toBe('HIGH');
  });

  test('resolves via explicit CSS fallback (MEDIUM confidence)', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    const { resolution } = await resolver.resolve(
      { name: 'Nonexistent Semantic Name', fallback: { css: '.only-css-reachable' } },
      'click',
    );

    expect(resolution.strategy).toBe('css');
    expect(resolution.confidence).toBe('MEDIUM');
  });
});

test.describe(`Locator Intelligence — safety rules ${TAGS.REGRESSION}`, () => {
  test('rejects an ambiguous match rather than picking an arbitrary element', async ({ page }) => {
    const resolver = new LocatorResolver(page);

    await expect(resolver.resolve({ name: 'Duplicate' }, 'click')).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  test('fails safely when no strategy finds a match at all', async ({ page }) => {
    const resolver = new LocatorResolver(page);

    await expect(
      resolver.resolve({ name: 'Totally Nonexistent Element' }, 'click'),
    ).rejects.toThrow(LocatorResolutionError);
  });

  test('rejects a hidden element instead of interacting with it', async ({ page }) => {
    const resolver = new LocatorResolver(page);

    await expect(resolver.resolve({ name: 'Hidden Action' }, 'click')).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  test('rejects a disabled element for a click action', async ({ page }) => {
    const resolver = new LocatorResolver(page);

    await expect(resolver.resolve({ name: 'Disabled Action' }, 'click')).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  test('never accepts an xpath-only match — LOW confidence always fails safely', async ({
    page,
  }) => {
    const resolver = new LocatorResolver(page);

    // A unique element genuinely exists at this xpath (verify that first),
    // yet resolution must still refuse it because xpath is LOW confidence.
    const xpath = '//button[@class="only-xpath-reachable"]';
    expect(await page.locator(`xpath=${xpath}`).count()).toBe(1);

    await expect(
      resolver.resolve({ name: 'Nonexistent Semantic Name 2', fallback: { xpath } }, 'click'),
    ).rejects.toThrow(LocatorResolutionError);
  });
});

test.describe(`Locator Intelligence — self-healing ${TAGS.REGRESSION}`, () => {
  test('heals when the primary locator fails but the semantic chain finds a unique match', async ({
    page,
  }) => {
    const resolver = new LocatorResolver(page);
    const { resolution } = await resolver.resolve(
      { name: 'Healing Target', primary: { testId: 'legacy-login-button' } },
      'click',
    );

    expect(resolution.healed).toBe(true);
    expect(resolution.originalLocator).toBe('testId="legacy-login-button"');
    expect(resolution.strategy).toBe('role');
    expect(resolution.confidence).toBe('HIGH');
  });

  test('does not report healing when the primary locator succeeds directly', async ({ page }) => {
    const resolver = new LocatorResolver(page);
    const { resolution } = await resolver.resolve(
      { name: 'Profile', primary: { testId: 'profile' } },
      'click',
    );

    expect(resolution.healed).toBe(false);
    expect(resolution.strategy).toBe('primary');
  });
});

test.describe(`Locator Intelligence — reporting ${TAGS.E2E}`, () => {
  test('attaches a LOCATOR HEALED report to the test result when healing occurs', async ({
    ui,
  }, testInfo) => {
    await ui.click({ name: 'Healing Target', primary: { testId: 'legacy-login-button' } });

    const healingAttachments = testInfo.attachments.filter((a) =>
      a.name.startsWith('locator-healing'),
    );
    expect(healingAttachments.length).toBeGreaterThan(0);

    const body = healingAttachments[0].body?.toString('utf-8') ?? '';
    expect(body).toContain('LOCATOR HEALED');
    expect(body).toContain('Test:');
    expect(body).toContain('Original: testId="legacy-login-button"');
    expect(body).toContain('Strategy: role');
    expect(body).toContain('Confidence: HIGH');
  });

  test('does not attach a report for a plain HIGH-confidence resolution', async ({
    ui,
  }, testInfo) => {
    await ui.click('Login');

    const healingAttachments = testInfo.attachments.filter((a) =>
      a.name.startsWith('locator-healing'),
    );
    expect(healingAttachments).toHaveLength(0);
  });

  test('attaches a report for a non-HIGH confidence resolution even without healing', async ({
    ui,
  }, testInfo) => {
    await ui.click({ name: 'Nonexistent Semantic Name', fallback: { css: '.only-css-reachable' } });

    const healingAttachments = testInfo.attachments.filter((a) =>
      a.name.startsWith('locator-healing'),
    );
    expect(healingAttachments.length).toBeGreaterThan(0);
    expect(healingAttachments[0].body?.toString('utf-8')).toContain('LOCATOR RESOLVED');
  });
});

test.describe(`Locator Intelligence — ui fixture end-to-end ${TAGS.SMOKE}`, () => {
  test('ui.click and ui.fill perform real actions via resolved locators', async ({ page, ui }) => {
    await ui.fill('Email', 'john@example.com');
    await expect(page.locator('#email-input')).toHaveValue('john@example.com');

    await ui.click('Login');
    // No assertion beyond "did not throw" — the button has no click handler
    // in this static fixture; the point is the action executed on the
    // correctly resolved element.
  });
});
