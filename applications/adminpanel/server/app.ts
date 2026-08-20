import express from 'express';
import * as path from 'path';
import * as crypto from 'crypto';

// A minimal reference app, structurally UNLIKE HRMS/Amazon — different
// pages, different labels, different domain (user administration, not
// leave/e-commerce) — built specifically to prove GAP's generic engine
// works against an application it has never seen before, with zero
// application-specific code added to the framework itself. See the user's
// own worked acceptance example: Login -> Open Users -> Add User ->
// fill/select -> Submit -> Verify created.

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Editor' | 'Viewer';
}

// Deliberately fake, local-only reference-app credentials — not real secrets.
const CREDENTIAL = { username: 'admin', password: 'Admin123!' };

/** Factory, not auto-started — lets tests spin up isolated instances on their own port. */
export function createApp(): express.Express {
  const app = express();
  const users: AdminUser[] = [
    { id: 'u1', name: 'Alex Admin', email: 'alex@example.com', role: 'Admin' },
  ];

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (username !== CREDENTIAL.username || password !== CREDENTIAL.password) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    res.json({ token: crypto.randomUUID() });
  });

  app.get('/api/users', (_req, res) => {
    res.json({ users });
  });

  app.post('/api/users', (req, res) => {
    const { name, email, role } = req.body ?? {};
    if (!name || !email || !role) {
      res.status(400).json({ error: 'Name, email, and role are all required' });
      return;
    }
    const user: AdminUser = { id: crypto.randomUUID(), name, email, role };
    users.push(user);
    res.status(201).json({ user });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.ADMINPANEL_PORT) || 4200;
  createApp().listen(port, () => {
    process.stdout.write(`AdminPanel reference app listening on http://localhost:${port}\n`);
  });
}
