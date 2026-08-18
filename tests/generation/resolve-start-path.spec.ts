import { test, expect } from '../../src/core/fixtures/base.fixture';
import { resolveStartPath } from '../../src/core/generation/generation-orchestrator';
import { TAGS } from '../../src/core/constants';

// Generic hosts throughout — this logic must not depend on HRMS or any
// other specific application.
test.describe(`Generation — Generate/Discovery start-path resolution ${TAGS.SMOKE}`, () => {
  test('a path embedded in --url is used as the start path when --start-path is not given', () => {
    expect(resolveStartPath('http://example.test/login.html', undefined)).toBe('/login.html');
  });

  test('a bare-origin --url (no path) falls back to the generic "/" default', () => {
    expect(resolveStartPath('http://example.test', undefined)).toBe('/');
  });

  test('an explicit --url with a root-only path ("/") also falls back to "/"', () => {
    expect(resolveStartPath('http://example.test/', undefined)).toBe('/');
  });

  test('an explicit --start-path always wins, even when --url also carries a different path', () => {
    expect(resolveStartPath('http://example.test/login.html', '/dashboard.html')).toBe(
      '/dashboard.html',
    );
  });

  test('an explicit --start-path wins over a bare-origin --url too', () => {
    expect(resolveStartPath('http://example.test', '/dashboard.html')).toBe('/dashboard.html');
  });

  test('a bare-origin --url falls back to the application\'s own registered startPath before the generic "/" default', () => {
    expect(resolveStartPath('http://example.test', undefined, '/app-home.html')).toBe(
      '/app-home.html',
    );
  });

  test('a path already embedded in --url still wins over the registered startPath', () => {
    expect(resolveStartPath('http://example.test/login.html', undefined, '/app-home.html')).toBe(
      '/login.html',
    );
  });

  test('an explicit --start-path still wins over the registered startPath too', () => {
    expect(resolveStartPath('http://example.test', '/other.html', '/app-home.html')).toBe(
      '/other.html',
    );
  });
});
