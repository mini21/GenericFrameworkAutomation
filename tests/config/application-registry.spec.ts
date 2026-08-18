import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';
import {
  getApplication,
  hasApplication,
  registerApplication,
  unregisterApplication,
  ensureApplicationRegistered,
} from '../../src/core/config/application-registry';

/**
 * Every test below uses an obviously-fake, timestamp-unique id and always
 * removes it in a `finally` via the real unregisterApplication — NOT a raw
 * fs edit of config/applications.json: a raw edit leaves this process's
 * in-process registry cache stale, and the next registerApplication call
 * in the same worker silently resurrects the "removed" entry by spreading
 * that stale cached copy back over the file (seen live: a raw-fs cleanup
 * here left a stray "gap-test-registry-*" entry behind permanently and
 * broke intent-resolver.spec.ts's "exactly one application registered"
 * assumption).
 */
function cleanUp(id: string): void {
  unregisterApplication(id);
  const appDir = path.resolve(process.cwd(), 'applications', id);
  if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
}

// Every test here mutates the SAME shared config/applications.json — run
// in parallel, two tests' writes race (the same class of shared-state bug
// as HRMS's own backend). Serial removes it the same way
// leave.spec.ts/approval.spec.ts already do for that.
test.describe.configure({ mode: 'serial' });

test.describe(`Application registry — dynamic registration ${TAGS.SMOKE}`, () => {
  test('hasApplication is false for an id nobody registered, true once it is', () => {
    const id = `gap-test-registry-${Date.now()}`;
    expect(hasApplication(id)).toBe(false);

    registerApplication(id, {
      name: 'Temp Test App',
      baseUrl: 'https://example.invalid',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });
    try {
      expect(hasApplication(id)).toBe(true);
      expect(getApplication(id).baseUrl).toBe('https://example.invalid');
    } finally {
      cleanUp(id);
    }
  });

  test('registerApplication refuses to silently overwrite an id that already exists', () => {
    expect(() =>
      registerApplication('hrms', {
        name: 'Should not overwrite',
        baseUrl: 'https://example.invalid',
        modules: [],
        authProfiles: [],
        defaultBrowser: 'chromium',
        supportedBrowsers: ['chromium'],
        dataProfiles: [],
      }),
    ).toThrow(/already exists/);
    // The real hrms entry must be completely untouched by the attempt.
    expect(getApplication('hrms').baseUrl).toBe('http://localhost:4100');
  });

  test('ensureApplicationRegistered auto-registers a never-seen id from just a baseUrl — no manual config edit needed', () => {
    const id = `gap-test-ensure-${Date.now()}`;
    expect(hasApplication(id)).toBe(false);

    ensureApplicationRegistered(id, 'https://newly-discovered.invalid', 'Newly Discovered App');
    try {
      const app = getApplication(id);
      expect(app.baseUrl).toBe('https://newly-discovered.invalid');
      expect(app.name).toBe('Newly Discovered App');
      // Minimal, never guessed: no modules/auth profiles invented for an app GAP has never seen used.
      expect(app.modules).toEqual([]);
      expect(app.authProfiles).toEqual([]);
      // The one exception: every generated test's template unconditionally
      // loads this default profile (code-generator.ts) — an empty scaffold
      // file is written alongside so that load never crashes, matching
      // what gap:onboard already does for a manually-onboarded app.
      expect(app.dataProfiles).toEqual(['qa-default']);
    } finally {
      cleanUp(id);
    }
  });

  test('ensureApplicationRegistered is a safe no-op for an id that is already registered', () => {
    // hrms is already registered with a real baseUrl — calling this must never touch it.
    ensureApplicationRegistered('hrms', 'https://this-must-be-ignored.invalid');
    expect(getApplication('hrms').baseUrl).toBe('http://localhost:4100');
  });

  test('getApplication still fails loudly for a truly unregistered id (no url/map to derive from, at this layer)', () => {
    expect(() => getApplication(`gap-test-unregistered-${Date.now()}`)).toThrow(
      /Unknown application/,
    );
  });

  test('unregisterApplication removes an id for real — a later registerApplication call never resurrects it', () => {
    // Regression for the exact bug this file hit: a raw fs.writeFileSync
    // cleanup (bypassing the module's cache) got silently undone by the
    // very next registerApplication call in the same process, because that
    // call built its new file content by spreading the still-stale cached
    // registry — which still had the "removed" entry in it.
    const removedId = `gap-test-unregister-${Date.now()}`;
    const nextId = `gap-test-next-${Date.now()}`;
    registerApplication(removedId, {
      name: 'Will be removed',
      baseUrl: 'https://example.invalid',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });
    unregisterApplication(removedId);
    expect(hasApplication(removedId)).toBe(false);

    registerApplication(nextId, {
      name: 'Registered right after a removal',
      baseUrl: 'https://example.invalid',
      modules: [],
      authProfiles: [],
      defaultBrowser: 'chromium',
      supportedBrowsers: ['chromium'],
      dataProfiles: [],
    });
    try {
      expect(hasApplication(removedId)).toBe(false); // still gone, not resurrected
      expect(hasApplication(nextId)).toBe(true);
    } finally {
      cleanUp(nextId);
    }
  });

  test('unregisterApplication is a safe no-op for an id that was never registered', () => {
    expect(() => unregisterApplication(`gap-test-never-registered-${Date.now()}`)).not.toThrow();
  });
});
