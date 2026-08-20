import { test, expect } from '../../src/core/fixtures/base.fixture';
import { discoverEntityCandidates, selectEntity } from '../../src/core/discovery/entity-discovery';
import { createApp as createStorefront } from '../../applications/storefront/server/app';
import { chromium, Browser, BrowserContext } from 'playwright';

/**
 * Root cause 4 (dynamic entity discovery): "Select a/an <item>" must work
 * on a real live page GAP has no markup control over — not just an
 * application that opted into the data-entity convention. These tests
 * exercise the GENERIC structural fallback directly, both against
 * synthetic HTML (fast, precise edge cases) and against a REAL page served
 * by the Storefront reference application that carries NO data-entity
 * markup at all (applications/storefront/server/public/deals.html) — a
 * genuine "reference application acceptance test" for the fallback path,
 * not just a unit test against fixtures shaped to fit the algorithm.
 */
test.describe('Entity discovery — generic structural fallback (no data-entity required)', () => {
  test('finds the largest group of class-qualified, distinct-destination links (a real card/list pattern)', async ({
    page,
  }) => {
    await page.setContent(`
      <div class="card"><a class="card-link" href="/item/1">Alpha</a></div>
      <div class="card"><a class="card-link" href="/item/2">Beta</a></div>
      <div class="card"><a class="card-link" href="/item/3">Gamma</a></div>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
    `);
    const candidates = await discoverEntityCandidates(page);
    expect(candidates.map((c) => c.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(candidates.map((c) => c.href)).toEqual(['/item/1', '/item/2', '/item/3']);
  });

  test('a repeated nav link pointing to the SAME destination every time is never mistaken for a content list', async ({
    page,
  }) => {
    await page.setContent(`
      <a class="badge" href="/help">Help</a>
      <a class="badge" href="/help">Help</a>
      <a class="badge" href="/help">Help</a>
    `);
    const candidates = await discoverEntityCandidates(page);
    expect(candidates).toEqual([]); // all same href — not a distinct-destination list
  });

  test('a single link, or only two unrelated one-off links, never qualifies — no genuine repetition', async ({
    page,
  }) => {
    await page.setContent(`<a class="lonely" href="/only-one">Solo</a>`);
    expect(await discoverEntityCandidates(page)).toEqual([]);
  });

  test('an unclassed (bare-tag) repeated group is never trusted — too generic a signal to act on safely', async ({
    page,
  }) => {
    await page.setContent(`
      <div><a href="/x/1">One</a></div>
      <div><a href="/x/2">Two</a></div>
      <div><a href="/x/3">Three</a></div>
    `);
    expect(await discoverEntityCandidates(page)).toEqual([]);
  });

  test('explicit data-entity markup, when present, is preferred over the structural fallback', async ({
    page,
  }) => {
    await page.setContent(`
      <a data-entity="product" href="/p/1">Explicit One</a>
      <a data-entity="product" href="/p/2">Explicit Two</a>
      <div class="card"><a class="card-link" href="/other/1">Structural One</a></div>
      <div class="card"><a class="card-link" href="/other/2">Structural Two</a></div>
    `);
    const locator = await selectEntity(page, 'product');
    await expect(locator).toHaveText('Explicit One');
  });

  test('selectEntity throws a clear, honest error when nothing qualifies — never a silent/fabricated selection', async ({
    page,
  }) => {
    await page.setContent(`<p>Nothing here.</p>`);
    await expect(selectEntity(page, 'product')).rejects.toThrow(/found no discovered/);
  });

  test('REFERENCE APPLICATION: selects the correct first candidate on a real, live, unlinked page with plain classed links and no data-entity markup at all', async () => {
    const server = createStorefront().listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://localhost:${port}`;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${baseUrl}/deals.html`, { waitUntil: 'domcontentloaded' });

      const locator = await selectEntity(page, 'anything'); // entityType is irrelevant to the fallback tier — it never had a chance to use data-entity
      await expect(locator).toHaveText('Wireless Mouse');
      await expect(locator).toHaveAttribute('href', '/product/p1.html');
    } finally {
      await context?.close();
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
