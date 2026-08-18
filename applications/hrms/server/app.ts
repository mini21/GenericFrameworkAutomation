import express from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import { TEST_ISOLATION_HEADER } from '../../../src/core/constants';

export type Role = 'employee' | 'manager';

export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  role: Role;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  /** See `isolationKeyOf` below — undefined for any caller that doesn't send it. */
  isolationToken?: string;
}

// This in-memory reference app has one shared `leaveRequests` array with no
// per-test reset — by design, so it behaves like a real stateful backend.
// Concurrent/sequential automated test runs would otherwise collide on it
// (the same fixed test employee applying for the same fixed date range from
// two different test files, or a manager's aggregate view picking up another
// still-pending test's request). The framework's `page`/`request` fixtures
// (see src/core/fixtures/test-isolation.fixture.ts) tag every request from
// one test with that test's own stable id via this header — entirely
// optional and app-agnostic on the framework side. This reference app is
// the one choosing to use it, to partition state per test the same way a
// real multi-tenant backend partitions per tenant. A caller that never
// sends the header (e.g. a real user, or a raw curl) is unaffected: it
// simply shares the single undefined-token bucket, exactly as before this
// existed.
function isolationKeyOf(req: express.Request): string | undefined {
  const header = req.headers[TEST_ISOLATION_HEADER];
  return typeof header === 'string' ? header : undefined;
}

// Deliberately fake, local-only reference-app credentials — not real
// secrets. See applications/hrms/data/qa-default.json and docs/PLATFORM.md.
const USERS: User[] = [
  {
    id: 'u-employee-1',
    username: 'employee1',
    password: 'Employee123!',
    name: 'Alex Employee',
    role: 'employee',
  },
  {
    id: 'u-employee-2',
    username: 'employee2',
    password: 'Employee123!',
    name: 'Sam Employee',
    role: 'employee',
  },
  {
    id: 'u-employee-3',
    username: 'employee3',
    password: 'Employee123!',
    name: 'Jordan Employee',
    role: 'employee',
  },
  {
    id: 'u-manager-1',
    username: 'manager1',
    password: 'Manager123!',
    name: 'Morgan Manager',
    role: 'manager',
  },
];

interface AuthedRequest extends express.Request {
  user?: User;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Factory, not auto-started — lets tests/tooling create isolated instances if ever needed. */
export function createApp(): express.Express {
  const app = express();
  const leaveRequests: LeaveRequest[] = [];
  const sessions = new Map<string, string>(); // token -> userId

  function currentUser(req: express.Request): User | undefined {
    const token = parseCookies(req.headers.cookie).gap_session;
    if (!token) return undefined;
    const userId = sessions.get(token);
    return USERS.find((u) => u.id === userId);
  }

  function requireAuth(role?: Role) {
    return (req: AuthedRequest, res: express.Response, next: express.NextFunction): void => {
      const user = currentUser(req);
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      if (role && user.role !== role) {
        res.status(403).json({ error: `Requires role "${role}"` });
        return;
      }
      req.user = user;
      next();
    };
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const user = USERS.find((u) => u.username === username && u.password === password);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const token = crypto.randomUUID();
    sessions.set(token, user.id);
    res.setHeader('Set-Cookie', `gap_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ user: { id: user.id, name: user.name, role: user.role } });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).gap_session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'gap_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => {
    const user = currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user: { id: user.id, name: user.name, role: user.role } });
  });

  app.get('/api/leave', requireAuth(), (req: AuthedRequest, res) => {
    const user = req.user as User;
    const isolationKey = isolationKeyOf(req);
    const inScope = leaveRequests.filter((r) => r.isolationToken === isolationKey);
    const requests =
      user.role === 'manager' ? inScope : inScope.filter((r) => r.employeeId === user.id);
    res.json({ requests });
  });

  app.post('/api/leave/apply', requireAuth('employee'), (req: AuthedRequest, res) => {
    const user = req.user as User;
    const isolationKey = isolationKeyOf(req);
    const { startDate, endDate, reason } = req.body ?? {};

    if (!startDate || !endDate || !reason) {
      res.status(400).json({ error: 'startDate, endDate, and reason are all required' });
      return;
    }
    if (startDate > endDate) {
      res.status(400).json({ error: 'startDate must not be after endDate' });
      return;
    }

    const overlapping = leaveRequests.some(
      (r) =>
        r.employeeId === user.id &&
        r.isolationToken === isolationKey &&
        (r.status === 'pending' || r.status === 'approved') &&
        datesOverlap(startDate, endDate, r.startDate, r.endDate),
    );
    if (overlapping) {
      res
        .status(409)
        .json({ error: 'Requested dates overlap an existing pending or approved leave request' });
      return;
    }

    const request: LeaveRequest = {
      id: crypto.randomUUID(),
      employeeId: user.id,
      startDate,
      endDate,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
      isolationToken: isolationKey,
    };
    leaveRequests.push(request);
    res.status(201).json({ request });
  });

  app.post('/api/leave/:id/cancel', requireAuth('employee'), (req: AuthedRequest, res) => {
    const user = req.user as User;
    const request = leaveRequests.find((r) => r.id === req.params.id);
    if (!request || request.employeeId !== user.id) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (request.status !== 'pending') {
      res.status(409).json({ error: `Cannot cancel a request with status "${request.status}"` });
      return;
    }
    request.status = 'cancelled';
    res.json({ request });
  });

  app.post('/api/leave/:id/approve', requireAuth('manager'), (req, res) => {
    const request = leaveRequests.find((r) => r.id === req.params.id);
    if (!request) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (request.status !== 'pending') {
      res.status(409).json({ error: `Cannot approve a request with status "${request.status}"` });
      return;
    }
    request.status = 'approved';
    res.json({ request });
  });

  app.post('/api/leave/:id/reject', requireAuth('manager'), (req, res) => {
    const request = leaveRequests.find((r) => r.id === req.params.id);
    if (!request) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (request.status !== 'pending') {
      res.status(409).json({ error: `Cannot reject a request with status "${request.status}"` });
      return;
    }
    request.status = 'rejected';
    res.json({ request });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.HRMS_PORT) || 4100;
  createApp().listen(port, () => {
    process.stdout.write(`HRMS reference app listening on http://localhost:${port}\n`);
  });
}
