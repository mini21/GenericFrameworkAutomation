import { Page } from 'playwright';
import { LocatorResolver } from '../locator/locator-resolver';
import { mapPage } from './page-crawler';
import { PageMap } from './discovery-types';

export interface DiscoveryCredential {
  username: string;
  password: string;
}

export interface AuthenticatedStart {
  /** The pathname the browser landed on after a successful login — where `crawlApplication`'s own BFS should resume from. */
  path: string;
  /**
   * The login page's own map, captured before submitting — the BFS that
   * resumes from `path` never revisits this page (nothing in the
   * authenticated area typically links back to it), so a caller must
   * splice this into its final ApplicationMap itself or a bare "Login as
   * X" step (mapLogin's inline-login fallback — see ui-mapper.ts) would
   * find no login-page-shaped entry to resolve against.
   */
  loginPage: PageMap;
}

/**
 * Lets discovery get past a login page without a pre-captured
 * `storageState` — generic same-origin same-crawler continuation, not a
 * second discovery engine. `page` must already be navigated to the crawl's
 * configured start path; this only acts when that page genuinely looks
 * like a login form.
 *
 * Detection reuses the EXISTING discovery engine (`mapPage`) and the same
 * verified username/password/login-button heuristic `ui-mapper.ts`'s
 * inline-login fallback already applies at code-generation time — nothing
 * new is invented here, it is applied live instead of only in generated
 * code. The actual fill/click goes through the EXISTING `LocatorResolver`,
 * exactly as every other verified interaction in this codebase does.
 *
 * Returns the pathname the browser landed on after a successful login (and
 * the login page's own map — see AuthenticatedStart), so the caller can
 * continue the EXISTING same-origin `crawlApplication` BFS from there.
 * Returns undefined — a safe no-op, never a guess — when the page doesn't
 * look like a login form, no credential was supplied, or the login attempt
 * itself fails; callers must fall back to whatever start path/storageState
 * they were already configured with.
 */
export async function establishAuthenticatedStart(
  page: Page,
  credential: DiscoveryCredential | undefined,
): Promise<AuthenticatedStart | undefined> {
  if (!credential) return undefined;

  const mapped = await mapPage(page).catch(() => undefined);
  if (!mapped) return undefined;

  const username = mapped.inputs.find((i) => /user/i.test(i.name) && i.verified);
  const password = mapped.inputs.find((i) => /pass/i.test(i.name) && i.verified);
  const loginButton = mapped.buttons.find((b) => /log\s*in/i.test(b.name) && b.verified);
  if (!username || !password || !loginButton) return undefined; // not a login page — nothing to do

  const resolver = new LocatorResolver(page);
  const urlBeforeSubmit = page.url();
  try {
    const usernameField = await resolver.resolve({ name: username.name }, 'fill');
    await usernameField.locator.fill(credential.username);
    const passwordField = await resolver.resolve({ name: password.name }, 'fill');
    await passwordField.locator.fill(credential.password);
    const submitButton = await resolver.resolve({ name: loginButton.name }, 'click');
    await submitButton.locator.click();
    // A login form may submit via a real navigation (waitForLoadState would
    // already be satisfied instantly for the CURRENT page) or via
    // fetch()-then-redirect (no navigation starts synchronously on click) —
    // waiting for the URL to actually change covers both, generically,
    // without assuming which one this app uses. If credentials were wrong
    // and the URL never changes, this simply times out — a safe no-op.
    await page.waitForURL((url) => url.toString() !== urlBeforeSubmit, { timeout: 5000 });
  } catch {
    return undefined; // resolution/interaction/navigation failed — never bypass, just report nothing gained
  }

  return { path: new URL(page.url()).pathname, loginPage: mapped };
}
