import express from 'express';
import * as path from 'path';
import { TEST_ISOLATION_HEADER } from '../../../src/core/constants';

// The CRITICAL-TEST reference application for the GAP architecture
// directive: a domain deliberately unrelated to every other reference app
// (HRMS = leave management, AdminPanel = user administration, Storefront =
// e-commerce) — a library catalog (Login, Books, Borrow, Return). Proves
// the SAME generic discovery/generation/execution engine works against a
// fourth, structurally different application with ZERO application-
// specific code added to GAP Core. If onboarding this app had required
// touching src/core or cli, the architecture would have failed its own
// acceptance test.

export interface Book {
  id: string;
  title: string;
}

const BOOKS: Book[] = [
  { id: 'b1', title: 'The Pragmatic Programmer' },
  { id: 'b2', title: 'Clean Code' },
  { id: 'b3', title: 'Design Patterns' },
  { id: 'b4', title: 'Refactoring' },
];

const READERS: Record<string, { password: string }> = {
  reader1: { password: 'Reader123!' },
};

// Same test-isolation convention as every other reference app's server
// (see applications/storefront/server/app.ts) — partitions "borrowed
// books" state per automated test run, not a real per-user session.
function isolationKeyOf(req: express.Request): string {
  const header = req.headers[TEST_ISOLATION_HEADER];
  return typeof header === 'string' ? header : '';
}

function bookPageHtml(book: Book): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${book.title}</title>
  </head>
  <body>
    <nav>
      <a href="/catalog.html">Catalog</a>
      <a href="/books.html">Books</a>
      <a href="/my-books.html">My Books</a>
    </nav>
    <h1>${book.title}</h1>
    <button id="borrow" type="button">Borrow</button>
    <p id="borrow-status" role="status"></p>
    <script>
      document.getElementById('borrow').addEventListener('click', async () => {
        const res = await fetch('/api/borrow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId: ${JSON.stringify(book.id)} }),
        });
        document.getElementById('borrow-status').textContent = res.ok
          ? 'Borrowed'
          : 'Could not borrow this book';
      });
    </script>
  </body>
</html>`;
}

/** Factory, not auto-started — lets tests spin up isolated instances on their own port. */
export function createApp(): express.Express {
  const app = express();
  const borrowed = new Map<string, string[]>(); // isolation key -> book ids

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const reader = READERS[username];
    if (!reader || reader.password !== password) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    res.status(200).json({ ok: true });
  });

  app.get('/api/search', (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase();
    const results = q ? BOOKS.filter((b) => b.title.toLowerCase().includes(q)) : [];
    res.json({ query: req.query.q ?? '', results });
  });

  app.get('/book/:idHtml', (req, res) => {
    const id = req.params.idHtml.replace(/\.html$/, '');
    const book = BOOKS.find((b) => b.id === id);
    if (!book) {
      res.status(404).send('Not found');
      return;
    }
    res.type('html').send(bookPageHtml(book));
  });

  app.get('/api/borrowed', (req, res) => {
    const ids = borrowed.get(isolationKeyOf(req)) ?? [];
    const items = ids
      .map((id) => BOOKS.find((b) => b.id === id))
      .filter((b): b is Book => Boolean(b));
    res.json({ items });
  });

  app.post('/api/borrow', (req, res) => {
    const { bookId } = req.body ?? {};
    const book = BOOKS.find((b) => b.id === bookId);
    if (!book) {
      res.status(400).json({ error: 'Unknown book' });
      return;
    }
    const key = isolationKeyOf(req);
    const items = borrowed.get(key) ?? [];
    items.push(book.id);
    borrowed.set(key, items);
    res.status(201).json({ ok: true });
  });

  app.post('/api/return', (req, res) => {
    const { bookId } = req.body ?? {};
    const key = isolationKeyOf(req);
    const items = (borrowed.get(key) ?? []).filter((id) => id !== bookId);
    borrowed.set(key, items);
    res.status(200).json({ ok: true });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.LIBRARY_PORT) || 4400;
  createApp().listen(port, () => {
    process.stdout.write(`Library reference app listening on http://localhost:${port}\n`);
  });
}
