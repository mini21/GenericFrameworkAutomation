import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { AddressInfo } from 'net';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { crawlApplication } from '../../src/core/discovery/site-crawler';
import {
  writeApplicationMapSafely,
  readApplicationMap,
} from '../../src/core/discovery/application-map-writer';
import { ApplicationMap } from '../../src/core/discovery/discovery-types';
import { createApp } from '../../applications/hrms/server/app';
import { TAGS } from '../../src/core/constants';

function appDir(application: string): string {
  return path.resolve(process.cwd(), 'applications', application);
}

function cleanupApplicationDir(application: string): void {
  const dir = appDir(application);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

const VERIFIED = {
  strategy: 'role' as const,
  confidence: 'HIGH' as const,
  resolvedLocator: 'getByRole(...)',
};

function usableMapFor(application: string): ApplicationMap {
  return {
    application,
    baseUrl: 'https://example.invalid',
    generatedAt: '2026-01-01T00:00:00.000Z',
    errors: [],
    pages: [
      {
        path: '/',
        url: 'https://example.invalid/',
        title: 'Home',
        pageName: 'Home',
        headings: [],
        buttons: [{ role: 'button', name: 'Search', verified: VERIFIED }],
        links: [],
        inputs: [],
        selects: [],
        checkboxes: [],
        tables: 0,
        forms: 0,
        navigation: 0,
        testIds: [],
        confirmationRegions: [],
        ariaSnapshot: '',
      },
    ],
  };
}

function emptyMapFor(application: string): ApplicationMap {
  return {
    application,
    baseUrl: 'https://example.invalid',
    generatedAt: '2026-01-02T00:00:00.000Z',
    errors: [],
    pages: [
      {
        path: '/',
        url: 'https://example.invalid/',
        title: '',
        pageName: '/',
        headings: [],
        buttons: [],
        links: [],
        inputs: [],
        selects: [],
        checkboxes: [],
        tables: 0,
        forms: 0,
        navigation: 0,
        testIds: [],
        confirmationRegions: [],
        ariaSnapshot: '',
      },
    ],
  };
}

test.describe(`Application Discovery — robustness ${TAGS.SMOKE}`, () => {
  test('1. existing HRMS discovery still works — a well-behaved app crawls to a full, usable map exactly as before', async ({
    context,
  }) => {
    const server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const map = await crawlApplication(context, {
        application: 'hrms-robustness-check',
        baseUrl: `http://localhost:${port}`,
        startPath: '/login.html',
        maxPages: 5,
      });

      expect(map.errors).toEqual([]);
      const loginPage = map.pages.find((p) => p.path === '/login.html');
      expect(loginPage?.inputs.some((i) => i.name === 'Username')).toBe(true);
      expect(loginPage?.buttons.some((b) => b.name === 'Login')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('2. a page whose real content only appears after an in-flight network request settles (the class of bug behind "Amazon discovery produces zero elements") is retried once and rescued', async ({
    context,
  }) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/data') {
        // Simulate a real page's own async data fetch that the visible
        // content waits on — keeps the network "busy" long enough for
        // domcontentloaded's own snapshot to have caught nothing yet.
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        }, 200);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`
        <html><head><title>Store</title></head><body>
          <div id="app">Loading…</div>
          <script>
            fetch('/api/data').then(() => {
              document.getElementById('app').innerHTML =
                '<h1>Store</h1><button>Search</button><input aria-label="Search box" />';
            });
          </script>
        </body></html>
      `);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const map = await crawlApplication(context, {
        application: 'async-render-check',
        baseUrl,
        startPath: '/',
        maxPages: 1,
      });

      expect(map.pages).toHaveLength(1);
      expect(map.pages[0].buttons.some((b) => b.name === 'Search')).toBe(true);
      expect(map.pages[0].inputs.some((i) => i.name === 'Search box')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('3. a discovery returning zero interactive elements never overwrites a valid existing map on disk', () => {
    const application = `discovery-robustness-guard-${Date.now()}`;
    cleanupApplicationDir(application);
    try {
      const good = writeApplicationMapSafely(usableMapFor(application));
      expect(good.written).toBe(true);

      const bad = writeApplicationMapSafely(emptyMapFor(application));
      expect(bad.written).toBe(false);
      expect(bad.skippedReason).toContain('Keeping the existing map');

      // The file on disk must still be the ORIGINAL good map, untouched.
      const onDisk = readApplicationMap(application);
      expect(onDisk?.pages[0].buttons.map((b) => b.name)).toEqual(['Search']);
      expect(onDisk?.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    } finally {
      cleanupApplicationDir(application);
    }
  });

  test('4. a redirected application is discovered under its final resolved URL/path, not the pre-redirect one', async ({
    context,
  }) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(302, { Location: '/home' }).end();
        return;
      }
      if (req.url === '/home') {
        res
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end(
            '<html><head><title>Home</title></head><body><h1>Home</h1><button>Get Started</button></body></html>',
          );
        return;
      }
      res.writeHead(404).end('not found');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const map = await crawlApplication(context, {
        application: 'redirect-check',
        baseUrl,
        startPath: '/',
        maxPages: 1,
      });

      expect(map.pages).toHaveLength(1);
      expect(map.pages[0].path).toBe('/home');
      expect(map.pages[0].buttons.some((b) => b.name === 'Get Started')).toBe(true);
      expect(map.errors).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('5. generic application discovery (any never-before-seen app) still crawls and writes a usable map end to end', async ({
    context,
  }) => {
    const application = `generic-discovery-check-${Date.now()}`;
    cleanupApplicationDir(application);
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end(
            '<html><head><title>Widgets Inc</title></head><body><h1>Widgets</h1><button>Buy Now</button></body></html>',
          );
        return;
      }
      res.writeHead(404).end('not found');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const map = await crawlApplication(context, {
        application,
        baseUrl,
        startPath: '/',
        maxPages: 5,
      });
      const result = writeApplicationMapSafely(map);

      expect(result.written).toBe(true);
      const onDisk = readApplicationMap(application);
      expect(onDisk?.pages[0].buttons.some((b) => b.name === 'Buy Now')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      cleanupApplicationDir(application);
    }
  });
});
