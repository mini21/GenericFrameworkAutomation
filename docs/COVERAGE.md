# Test Coverage / Requirement Traceability

**Passing tests are not test coverage.** This capability answers a
different question: _of everything the product is supposed to do, how much
is actually automated at all_ — regardless of whether those automated
tests currently pass or fail. That's requirement coverage, and it's kept
strictly separate from execution pass rate everywhere in this framework.

## The model: requirements → stable test IDs

Source of truth: `test-data/static/requirements.json`.

```json
{
  "requirements": {
    "AUTH-001": {
      "name": "User Login",
      "priority": "Critical",
      "feature": "Authentication",
      "tests": ["auth.login.valid", "auth.login.invalid"]
    }
  }
}
```

| Field      | Required | Meaning                                                                   |
| ---------- | -------- | ------------------------------------------------------------------------- |
| `name`     | yes      | Human-readable requirement description.                                   |
| `priority` | yes      | `Critical` \| `High` \| `Medium` \| `Low`.                                |
| `feature`  | no       | Optional grouping, enables per-feature coverage in the report.            |
| `tests`    | yes      | Stable test IDs (see below) that automate this requirement. Can be empty. |

JSON was chosen over YAML because it's what the rest of `test-data/` already
uses (`readJson`/`loadStaticData`, see `test-data/utils/static-data.util.ts`)
— zero new dependencies, one convention across the whole project.

## Stable test IDs — not titles

Test titles change. To keep the requirement mapping stable across title
rewrites, this framework uses Playwright's **native `tag` test option**
(introduced specifically for this kind of metadata), not the title string:

```ts
test(
  'logs in with valid credentials @smoke',
  { tag: ['@auth.login.valid'] },
  async ({ loginPage }) => {
    /* ... */
  },
);
```

The tag is written with a leading `@` in code (Playwright's own
convention, same as `--grep @smoke`), but appears **without** the `@` in
`requirements.json` and in Playwright's own test-list output — the
coverage calculator compares them exactly as Playwright reports them, no
stripping needed on your end.

Retrofitting an existing test with a stable ID is purely additive — it
doesn't change what the test does, so it's always safe to add.

## How coverage is calculated

`src/core/coverage/`:

- **`test-discovery.ts`** — runs `npx playwright test --list --reporter=json`
  (list mode only, nothing executes) via `child_process`, parses Playwright's
  own JSON test-list format, and returns every discovered test's title,
  file, and tags. Independent of any application.
- **`coverage-calculator.ts`** — pure function: `(requirements,
discoveredTests) => CoverageResult`. A requirement is **covered** if at
  least one of its declared test IDs appears among the discovered tests'
  tags — regardless of pass/fail, because discovery never executes anything.
- **`coverage-report.ts`** — formats a `CoverageResult` as human-readable text.

```
covered requirements / total requirements × 100 = Requirement Coverage %
```

Also calculated, all from real data (nothing invented):

- **Critical Requirement Coverage** — same formula, filtered to `priority: Critical`.
- **Feature Coverage** — per-`feature` breakdown, when requirements declare one.
- **Test-to-Requirement Mapping Rate** — the inverse direction: of all
  discovered/automated tests, what fraction carry a tag that's referenced
  by _some_ requirement. Catches orphan tests with no traceability link.

## Pass rate vs. coverage — never conflated

```
100 automated tests, 98 passed  → Execution Pass Rate = 98%
120 requirements, 96 mapped     → Requirement Coverage = 80%
```

These come from different sources and are logged under different, explicit
labels — `src/core/reporter/summary-reporter.ts`'s `onEnd()`:

```
Run finished: passed {"failedCount":0,"executionPassRate":"100% (58/58)"}
Requirement coverage (NOT execution pass rate) {"requirementCoverage":"90.9% (10/11)", ...}
```

`executionPassRate` comes from `onTestEnd()` counting _this run's_ actual
results. `requirementCoverage` comes from `reports/coverage/coverage.json`
(only written when the `coverage` project has run — see below) — if that
file is missing, nothing is logged; the two numbers are never merged into
one, and the report explicitly labels which is which.

## Generating the report

```bash
npm run coverage:report
```

Runs `tests/coverage/coverage-report.spec.ts` under its own dedicated
`coverage` Playwright project (`testDir: './tests/coverage'`, no browser),
writing:

- **`reports/coverage/coverage.txt`** — human-readable:

  ```
  GAP TEST COVERAGE
  =================

  Requirement Coverage: 90.9%
  Critical Requirement Coverage: 100%
  Feature Coverage (avg across 6 features): 83.3%

  Total Requirements: 11
  Covered: 10
  Uncovered: 1

  Uncovered Requirements:
  - PAYMENTS-001

  Test-to-Requirement Mapping Rate: 28.4% (23/81 discovered tests reference a requirement)

  Feature Coverage Breakdown:
  - Authentication: 100% (2/2)
  - Posts API: 100% (4/4)
  ...
  ```

- **`reports/coverage/coverage.json`** — the same data, machine-readable
  (`CoverageResult`, see `src/core/coverage/coverage-types.ts`), for CI
  artifacts or dashboards.

Both are also attached to the `coverage` test's Playwright result via
`testInfo.attach()` — visible natively in the HTML report and Allure, same
mechanism as Locator Intelligence's healing reports.

### The gate

The coverage spec asserts `criticalCoveragePercent === 100` — every
`Critical`-priority requirement must have at least one automated test, or
the run fails with the list of uncovered IDs in the error message. This is
enforceable in CI the same way any other test is. It's intentionally scoped
to `Critical` only, not all requirements — demanding 100% overall coverage
is unrealistic for most real projects.

## Interpreting the report

- **0% for a feature** doesn't mean nothing works — it means nothing in
  that feature has an automated test with a matching stable ID yet.
- A requirement with `"tests": []` is always uncovered by definition.
- The mapping rate being low (e.g. 28%) is normal early on — it just means
  most currently-automated tests aren't yet linked to a requirement ID.
  Add `tag`s incrementally; there's no requirement to retrofit everything
  at once.

## Limitations

- Coverage reflects what's **declared automated**, not test quality — a
  single trivial test satisfies "covered" the same as a thorough one.
- `test-discovery.ts` shells out to a second Playwright process
  (`--list`); this is fast (list mode does no real work) but does add a
  child-process spawn, so avoid calling `discoverTests()` in a hot loop.
- Requirements with no `feature` are excluded from the Feature Coverage
  breakdown (not counted as 0% — genuinely omitted, since there's nothing
  to group them by).
- This is deliberately not a full test-management-system integration
  (Jira/TestRail/Xray) — `requirements.json` is meant to be hand-maintained
  or generated from wherever your real requirements live, not a
  replacement for that system.
