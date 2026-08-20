import express from 'express';
import * as path from 'path';

// A second reference app, deliberately unrelated to both HRMS (leave
// management) and AdminPanel (user administration) — an e-commerce-shaped
// domain with its own labels/pages/controls, proving the SAME generic
// engine works against a third, structurally different application with
// zero application-specific framework code. Covers what AdminPanel
// doesn't: a search box whose results only ever exist after a real submit
// (never present at static-discovery time), static product cards/lists,
// two forms sharing an identically-named "Submit" button, a checkbox, and
// a redirecting legacy URL.

export interface Product {
  id: string;
  name: string;
}

const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Wireless Mouse' },
  { id: 'p2', name: 'Mechanical Keyboard' },
  { id: 'p3', name: 'USB-C Hub' },
  { id: 'p4', name: 'Laptop Stand' },
];

/** Factory, not auto-started — lets tests spin up isolated instances on their own port. */
export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/search', (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase();
    const results = q ? PRODUCTS.filter((p) => p.name.toLowerCase().includes(q)) : [];
    res.json({ query: req.query.q ?? '', results });
  });

  app.post('/api/contact', (req, res) => {
    const { name, email, message } = req.body ?? {};
    if (!name || !email || !message) {
      res.status(400).json({ error: 'Name, email, and message are all required' });
      return;
    }
    res.status(201).json({ ok: true });
  });

  app.get('/old-home.html', (_req, res) => {
    res.redirect(301, '/');
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.STOREFRONT_PORT) || 4300;
  createApp().listen(port, () => {
    process.stdout.write(`Storefront reference app listening on http://localhost:${port}\n`);
  });
}
