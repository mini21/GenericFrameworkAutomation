import express from 'express';
import * as path from 'path';
import { TEST_ISOLATION_HEADER } from '../../../src/core/constants';

// A second reference app, deliberately unrelated to both HRMS (leave
// management) and AdminPanel (user administration) — an e-commerce-shaped
// domain with its own labels/pages/controls, proving the SAME generic
// engine works against a third, structurally different application with
// zero application-specific framework code. Covers what AdminPanel
// doesn't: a search box whose results only ever exist after a real submit
// (never present at static-discovery time), static product cards/lists (via
// the generic `data-entity` convention — see page-crawler.ts), a
// product-details page reached only through a live search or the static
// catalog, a cart with its own per-session state, two forms sharing an
// identically-named "Submit" button, a checkbox, and a redirecting legacy
// URL.

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

// Same test-isolation convention as applications/hrms/server/app.ts — see
// that file's own comment for why: partitions cart state per automated
// test the same way a real multi-tenant backend partitions per tenant.
function isolationKeyOf(req: express.Request): string {
  const header = req.headers[TEST_ISOLATION_HEADER];
  return typeof header === 'string' ? header : '';
}

function productPageHtml(product: Product): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${product.name}</title>
  </head>
  <body>
    <nav>
      <a href="/">Search</a>
      <a href="/products.html">Products</a>
      <a href="/cart.html">Cart</a>
      <a href="/contact.html">Contact</a>
    </nav>
    <h1>${product.name}</h1>
    <button id="add-to-cart" type="button">Add to Cart</button>
    <p id="cart-status" role="status"></p>
    <script>
      document.getElementById('add-to-cart').addEventListener('click', async () => {
        const res = await fetch('/api/cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: ${JSON.stringify(product.id)} }),
        });
        document.getElementById('cart-status').textContent = res.ok
          ? 'Added to cart'
          : 'Could not add to cart';
      });
    </script>
  </body>
</html>`;
}

/** Factory, not auto-started — lets tests spin up isolated instances on their own port. */
export function createApp(): express.Express {
  const app = express();
  const carts = new Map<string, string[]>(); // isolation key -> product ids

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

  app.get('/product/:idHtml', (req, res) => {
    const id = req.params.idHtml.replace(/\.html$/, '');
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) {
      res.status(404).send('Not found');
      return;
    }
    res.type('html').send(productPageHtml(product));
  });

  app.get('/api/cart', (req, res) => {
    const ids = carts.get(isolationKeyOf(req)) ?? [];
    const items = ids
      .map((id) => PRODUCTS.find((p) => p.id === id))
      .filter((p): p is Product => Boolean(p));
    res.json({ items });
  });

  app.post('/api/cart', (req, res) => {
    const { productId } = req.body ?? {};
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      res.status(400).json({ error: 'Unknown product' });
      return;
    }
    const key = isolationKeyOf(req);
    const items = carts.get(key) ?? [];
    items.push(product.id);
    carts.set(key, items);
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
