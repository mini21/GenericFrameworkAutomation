import * as http from 'http';
import { AddressInfo } from 'net';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { crawlApplication } from '../../src/core/discovery/site-crawler';
import { establishAuthenticatedStart } from '../../src/core/discovery/authenticated-start';
import { TAGS } from '../../src/core/constants';

const VALID_USERNAME = 'employee1';
const VALID_PASSWORD = 'Sup3rSecret!'; // fixture-only, not a real credential

const LOGIN_PAGE = `<html><head><title>Login</title></head><body>
  <h1>Sign in</h1>
  <form id="login-form">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" />
    <button type="submit">Login</button>
  </form>
  <p id="error" role="alert"></p>
  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        document.getElementById('error').textContent = 'Invalid credentials';
      }
    });
  </script>
</body></html>`;

const DASHBOARD_UNAUTHENTICATED = `<html><head><title>Dashboard</title></head><body>
  <h1>Please log in</h1>
</body></html>`;

const DASHBOARD_AUTHENTICATED = `<html><head><title>Dashboard</title></head><body>
  <h1>Dashboard</h1>
  <a href="/secret">Secret Area</a>
</body></html>`;

const SECRET_PAGE = `<html><head><title>Secret</title></head><body>
  <h1>Secret Area</h1>
</body></html>`;

let server: http.Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const hasSession = (req.headers.cookie ?? '').includes('session=valid');

    if (req.method === 'POST' && req.url === '/api/login') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const { username, password } = JSON.parse(body) as { username: string; password: string };
        if (username === VALID_USERNAME && password === VALID_PASSWORD) {
          res
            .writeHead(200, {
              'Set-Cookie': 'session=valid; Path=/',
              'Content-Type': 'application/json',
            })
            .end('{}');
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"invalid"}');
        }
      });
      return;
    }

    if (req.url === '/login') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(LOGIN_PAGE);
      return;
    }
    if (req.url === '/dashboard') {
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(hasSession ? DASHBOARD_AUTHENTICATED : DASHBOARD_UNAUTHENTICATED);
      return;
    }
    if (req.url === '/secret') {
      if (!hasSession) {
        res.writeHead(403).end('forbidden');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(SECRET_PAGE);
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.describe(`Application Discovery — authenticated start ${TAGS.SMOKE}`, () => {
  test('unauthenticated discovery does not invent authenticated pages', async ({ context }) => {
    // The plain, EXISTING crawler with no credential/storageState at all —
    // exactly today's behavior, untouched. /login has no <a href> links
    // (it's a JS-driven form), so the crawl can only ever find /login.
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: '/login',
      maxPages: 15,
    });

    expect(map.pages.map((p) => p.path)).toEqual(['/login']);
    expect(map.pages[0].pageName).not.toContain('Dashboard');
  });

  test('a login-shaped page with no credential is left alone — safe no-op, not a guess', async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/login`);
    const landed = await establishAuthenticatedStart(page, undefined);
    expect(landed).toBeUndefined();
  });

  test('a non-login page (no username/password/submit) is left alone even with a valid credential', async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/secret`); // 403 body, no form at all
    const landed = await establishAuthenticatedStart(page, {
      username: VALID_USERNAME,
      password: VALID_PASSWORD,
    });
    expect(landed).toBeUndefined();
  });

  test('authenticated discovery can discover additional same-origin pages', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    const authenticated = await establishAuthenticatedStart(page, {
      username: VALID_USERNAME,
      password: VALID_PASSWORD,
    });
    expect(authenticated?.path).toBe('/dashboard');
    // The login page's own map is captured too — see loginPage's doc
    // comment: the BFS that resumes from the authenticated path never
    // revisits it, so a caller needs it returned explicitly.
    expect(authenticated?.loginPage.path).toBe('/login');
    expect(authenticated?.loginPage.inputs.map((i) => i.name).sort()).toEqual([
      'Password',
      'Username',
    ]);
    await page.close();

    // Continue with the EXISTING, unmodified crawler from the authenticated
    // landing page — same-origin BFS reaches pages that were unreachable
    // (and, per the test above, undiscoverable) without authentication.
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: authenticated!.path,
      maxPages: 15,
    });

    expect(map.pages.map((p) => p.path).sort()).toEqual(['/dashboard', '/secret']);
    const dashboard = map.pages.find((p) => p.path === '/dashboard');
    expect(dashboard?.links.map((l) => l.name)).toContain('Secret Area');
  });

  test('no credential appears anywhere in the resulting ApplicationMap', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    const authenticated = await establishAuthenticatedStart(page, {
      username: VALID_USERNAME,
      password: VALID_PASSWORD,
    });
    await page.close();

    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: authenticated!.path,
      maxPages: 15,
    });

    const serialized = JSON.stringify(map);
    expect(serialized).not.toContain(VALID_PASSWORD);
    expect(serialized).not.toContain(VALID_USERNAME);
  });

  test('existing direct discovery (crawlApplication) is unmodified — same result as before authenticated-start existed', async ({
    context,
  }) => {
    const map = await crawlApplication(context, {
      application: 'fixture-app',
      baseUrl,
      startPath: '/dashboard', // unauthenticated: server serves the "please log in" variant
      maxPages: 15,
    });

    expect(map.pages).toHaveLength(1);
    expect(map.pages[0].headings).toEqual(['Please log in']);
    expect(map.errors).toEqual([]);
  });
});
