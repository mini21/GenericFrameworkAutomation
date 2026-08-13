# Locator Intelligence

A `ui.click('Login')` / `ui.fill('Username', 'john')` API that resolves
locators deterministically through Playwright's own recommended locator
methods — no custom locator engine, no AI/ML, no DOM-similarity guessing.
Every candidate it tries is a plain `page.getByRole()`/`getByLabel()`/
`getByPlaceholder()`/`getByText()`/`getByTestId()`/`page.locator()` call.

## Basic usage

```ts
import { test, expect } from '../../src/core/fixtures/base.fixture';

test('logs in', async ({ ui, page }) => {
  await ui.fill('Username', 'john');
  await ui.fill('Password', 'secret');
  await ui.click('Login');
});
```

`ui` is a fixture (`src/core/fixtures/locator.fixture.ts`), independent of
any page object or application — it only needs `page`. Three methods:

- `ui.click(name)` — resolves and clicks.
- `ui.fill(name, value)` — resolves and fills.
- `ui.locate(name, action?)` — resolves without acting, returns the
  `Locator` itself for anything else (`check()`, `selectOption()`,
  assertions, ...). `action` defaults to `'click'` and only affects which
  role guesses and usability checks are used during resolution.

## Resolution order

For a given `name`, in order, stopping at the first **unique, usable**
match:

1. **`getByRole()`** — tries a small, fixed set of role guesses appropriate
   to the action (`button`/`link`/`checkbox`/`radio`/`menuitem`/`tab` for
   `click`; `textbox`/`searchbox`/`spinbutton` for `fill`). This is a
   deterministic lookup table, not a guess based on DOM structure.
2. **`getByLabel(name)`**
3. **`getByPlaceholder(name)`**
4. **`getByText(name, { exact: true })`**
5. **`getByTestId(slugify(name))`** — `name` is lowercased,
   non-alphanumeric runs collapsed to `-`. `'Login Button'` → looks for
   `data-testid="login-button"`.
6. **CSS** — only if `fallback.css` was explicitly provided.
7. **XPath** — only if `fallback.xpath` was explicitly provided. **Always
   refused even if it uniquely matches** — see Confidence below.

**Note on role vs. label/placeholder**: a properly labeled form input's
accessible name (per the ARIA spec) already incorporates its `<label>` or
`placeholder`, so `getByRole` frequently succeeds before label/placeholder
are ever tried — this is correct, not a bug. Label/placeholder strategies
only "win" for elements role-guessing can't reach (e.g. a `<select>`, whose
role is `combobox`, isn't in the click/fill role-guess lists).

### Uniqueness and usability

Every candidate is checked for `count() === 1` before being accepted —
**an ambiguous match (2+ elements) is never resolved by picking the
first one.** It's also checked for usability: visible, and enabled for
`click` (additionally editable for `fill`). A hidden or disabled element
that technically matches is rejected and resolution moves to the next
strategy, exactly like a zero-match "not found."

If nothing in the chain produces a unique, usable match, `ui.click`/
`ui.fill`/`ui.locate` throws `LocatorResolutionError` with every attempted
strategy and why it failed.

## Confidence levels

| Confidence | Strategies                              | Behavior                                                                     |
| ---------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| **HIGH**   | primary (explicit), role, label, testId | Executes automatically, logged at debug level only.                          |
| **MEDIUM** | placeholder, text, css fallback         | Executes, but logs a warning and attaches a report — see below.              |
| **LOW**    | xpath fallback                          | **Never executes.** Always fails safely, even if the xpath uniquely matches. |

The rule is deliberately strict on XPath: it's the most brittle locator
type (tied to DOM structure rather than semantics), and per the design
goal — never let a test silently interact with an uncertain element — a
LOW-confidence match is refused outright rather than acted on with a
warning. If you need XPath to actually work, add a `testId`, role, or
label to the element instead.

## Self-healing

Specify an explicit `primary` locator (from a legacy page object, say) plus
a semantic `name` for the resolver to fall back to if the primary breaks:

```ts
await ui.click({ name: 'Login', primary: { testId: 'login-button' } });
```

If `testId="login-button"` still exists, it's used directly (`strategy:
'primary'`, no healing). If it's gone (renamed, removed) but a button
named "Login" exists via role/label/etc., the resolver "heals" — uses the
chain result instead, and records:

- **Original locator** (the primary that failed)
- **Resolved locator** (what actually matched)
- **Resolution strategy**
- **Confidence**
- **Test name**
- **Timestamp**

This is deterministic, not AI-based: healing only succeeds when the
semantic chain finds an unambiguous, usable match through the same rules
as every other resolution — there's no fuzzy scoring or DOM-similarity
comparison.

## Reporting — nothing is hidden

Any resolution that's healed or not HIGH confidence:

1. Logs a warning via the centralized logger (`logs/run.log`).
2. Attaches a plain-text report to the Playwright test result via
   `testInfo.attach()` — a native Playwright mechanism, so it shows up
   automatically in both the HTML report and Allure (no custom Allure API
   calls needed):

   ```
   LOCATOR HEALED

   Test: Login › valid credentials
   Original: testId="login-button"
   Resolved: getByRole("button", { name: "Login" })
   Strategy: role
   Confidence: HIGH
   Timestamp: 2026-08-13T14:58:31.744Z
   ```

A plain HIGH-confidence, non-healed resolution attaches nothing and only
logs at debug level — this keeps reports focused on what actually needs
attention.

## Writing tests for the resolver itself

`tests/locator/locator-resolver.spec.ts` is the dedicated suite —
`tests/locator/fixtures/locator-test-page.html` is a small, self-contained
static page (loaded via `page.setContent()`, no server/app needed) with
purpose-built elements isolating each strategy, plus ambiguous/hidden/
disabled/xpath-only/healing cases. Run it directly:

```bash
npm run test:locator
```

It runs across all browser projects (chromium/firefox/webkit) since it
genuinely exercises real browser locator resolution — unlike, say,
`db-client.spec.ts`, which needs no browser at all.

## Limitations

- Role guessing is a **fixed, small list** per action — an element whose
  correct role isn't in that list (e.g. `slider`, `switch`) will never
  resolve via role. Use an explicit `primary`/`fallback` in that case.
- `getByText` uses `{ exact: true }` — partial/substring text matches are
  intentionally not attempted, to avoid over-broad matches.
- The `testId` strategy derives the expected `data-testid` value by
  slugifying `name` — if your app's test IDs don't follow a
  `name`-derived convention, pass an explicit `primary.testId` instead.
- CSS/XPath fallbacks only activate when you explicitly provide them —
  the resolver never invents a CSS selector on its own.
- `ui.click`/`ui.fill` cover the two actions from the spec; for anything
  else, use `ui.locate()` to get the resolved `Locator` and call whatever
  Playwright API you need on it directly.
