import * as http from 'http';
import { AddressInfo } from 'net';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { crawlApplication } from '../../src/core/discovery/site-crawler';
import { TAGS } from '../../src/core/constants';

const PAGES: Record<string, string> = {
  '/': `<html><head><title>Home</title></head><body>
    <h1>Home</h1>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
    <a href="https://example.com/external">External</a>
    <a href="mailto:someone@example.com">Email us</a>
    <a href="/brochure.pdf">Brochure</a>
  </body></html>`,
  '/about': `<html><head><title>About</title></head><body>
    <h1>About</h1>
    <a href="/">Back home</a>
    <a href="/contact">Contact</a>
  </body></html>`,
  '/contact': `<html><head><title>Contact</title></head><body>
    <h1>Contact</h1>
  </body></html>`,
};

let server: http.Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[req.url ?? '/'];
    if (!body) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.describe(`Application Discovery — site crawl ${TAGS.SMOKE}`, () => {
  test('crawls every same-origin page reachable from the start path, deduping mutual links', async ({
    context,
  }) => {
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: '/',
      maxPages: 15,
    });

    expect(map.pages.map((p) => p.path).sort()).toEqual(['/', '/about', '/contact']);
    expect(map.errors).toEqual([]);
  });

  test('never follows a link to a different origin, a non-http scheme, or a download extension', async ({
    context,
  }) => {
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: '/',
      maxPages: 15,
    });

    const urls = map.pages.map((p) => p.url);
    expect(urls.every((url) => url.startsWith(baseUrl))).toBe(true);
    expect(urls.some((url) => url.includes('example.com'))).toBe(false);
  });

  test('stops at maxPages even when more same-origin links remain in the queue', async ({
    context,
  }) => {
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: '/',
      maxPages: 1,
    });

    expect(map.pages).toHaveLength(1);
    expect(map.pages[0].path).toBe('/');
  });

  test('the application map records the requested application id, baseUrl, and a generation timestamp', async ({
    context,
  }) => {
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: '/contact',
      maxPages: 1,
    });

    expect(map.application).toBe('fixture-app');
    expect(map.baseUrl).toBe(baseUrl);
    expect(new Date(map.generatedAt).toString()).not.toBe('Invalid Date');
  });
});
