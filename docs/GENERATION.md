# URL → Requirement → Working Automation (GAP v2.0)

The complete pipeline: a Manual QA gives GAP an application URL/environment/
authentication and a plain-English requirement, and GAP discovers the
application, understands the requirement, maps it to real discovered UI,
generates a real Playwright test, validates it (typecheck, lint, actually
runs it), asks for approval, and — once approved — wires it into the
existing requirement-coverage/traceability system.

```bash
npm run gap:generate -- \
  --application=hrms --environment=qa \
  --url=http://localhost:4100 --start-path=/dashboard.html \
  --storage-state=/tmp/state.json \
  --requirement-file=requirement.txt \
  --approve
```

Or interactively through `npm run gap`:

```
GAP > Create automation for HRMS at http://localhost:4100 in QA.
```

GAP asks for whatever's missing (application, environment, URL, then the
requirement/scenario) and runs the same pipeline.

## What this reuses — nothing here is a second engine

```
--url, --requirement
   ↓
Application Discovery        ← EXISTING src/core/discovery/ (site-crawler, page-crawler)
   ↓
Application Map              ← EXISTING applications/<id>/discovery/application-map.json
   ↓
Requirement parser           ← NEW, deterministic, same philosophy as the Phase 1 intent parser
   ↓
UI mapper                    ← NEW, but every element it returns was verified through the
   ↓                            EXISTING LocatorResolver — never a guessed locator
Test specification
   ↓
Code generator                ← NEW, emits code using EXISTING fixtures/ui.click/ui.fill/tags
   ↓
typecheck / lint / execute    ← EXISTING tsc, eslint, and the EXISTING execution engine
   ↓                            (resolveExecution/toPlaywrightArgs, just pointed at one file)
Human approval
   ↓
requirements.json             ← the SAME file the EXISTING coverage calculator already reads
   ↓
Existing coverage/reporting   ← unchanged
```

No second execution engine, no second locator engine, no second coverage
system — see `src/core/generation/generation-orchestrator.ts` for the
whole pipeline in one place.

## Writing a requirement GAP can act on

The parser is deterministic (no LLM) — it recognizes a fixed set of
explicit step patterns, one per line/sentence. A goal-only sentence like
"Employee should be able to apply leave." names the requirement but
contains no actionable steps by itself; follow it with explicit steps:

```
Employee should be able to apply leave.
Login as employee.
Open Apply Leave.
Select start and end dates.
Fill Reason as "Family trip".
Submit the request.
Verify "Leave application submitted successfully" is shown.
```

| Pattern                                                  | Produces                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Login as <role>`                                        | Reuses an existing `applications/<id>/fixtures/*.ts` login helper if one exists; otherwise builds inline login from a discovered login page |
| `Open <Page Name>`                                       | `page.goto()` to the uniquely-named discovered page                                                                                         |
| `Select start and end dates`                             | Two fill steps with dates computed at test-run time (`Date.now() + N days`), never a hardcoded literal                                      |
| `Fill <Field> as "value"` / `Select "value" for <Field>` | `ui.fill()` against the verified discovered field                                                                                           |
| `Click <Name>` / `Submit the request`                    | `ui.click()` against the verified discovered button/link                                                                                    |
| `Verify "expected text" is shown`                        | `expect(page.getByText("...")).toBeVisible()`                                                                                               |

Values are **always quoted** on purpose — an unquoted, vague value ("select
the right leave type") has no safe way to resolve without guessing, which
the design explicitly forbids. A sentence matching none of these patterns
is silently skipped, not force-mapped to something wrong.

## When GAP can't confidently map a step

Every click/fill target is looked up in the Application Map and must
resolve to exactly one **verified** element. Anything else — zero matches,
more than one match, or a discovered-but-unverified element — is reported,
never guessed:

```
GAP: Unable to confidently map 1 step(s) to the discovered application:
  - "Open Reports": No discovered, verified page matches "Reports".
```

## Validation before approval

Before a human ever sees an approval prompt, the generated file must pass
all three, in order — a broken/failing generation is deleted automatically
and never reaches the approval step:

1. `tsc --noEmit` (whole project)
2. `eslint <file>`
3. Actually executed through the existing engine (`resolveExecution` with
   a `testFile` override — see below)

## Approval

```
[A]pprove / [E]dit / [R]eject
```

`--approve` auto-approves for CI/non-interactive use — the screen is still
printed first, never silently. Reject deletes the generated file entirely;
nothing is left half-saved.

## Coverage/traceability integration

On approval, the requirement is appended to the application's **existing**
`requirements.json` with `tests: ["<app>.<module>.generated.<n>"]` — the
exact same field hand-written requirements already use. The generated
spec's tag list includes that same stable id, so the existing coverage
calculator (`GAP_APPLICATION=<id> npm run coverage:report`) recognizes it
with zero changes to the coverage engine itself.

## The `testFile` execution-engine extension

`src/core/execution/execution-resolver.ts` gained one optional field:
`CliOverrides.testFile`/`ResolvedExecution.testFile`. When set,
`toPlaywrightArgs()` targets that exact spec instead of
`applications/<app>/tests`. This is the only change to the existing
execution engine in this milestone — additive, optional, and unused by
every existing caller (`gap-test.ts`, `gap.ts`'s RUN flow) so nothing about
running existing tests changed.

## Known limitations

- **No generated-test cleanup.** Hand-written HRMS specs carry deliberate
  `uniqueReason()`/date-offset/cancel logic specifically because the
  reference app's backend is shared, in-memory state (see
  `docs/TROUBLESHOOTING.md`). A generated test does not yet add that
  automatically — running a generated test repeatedly, or alongside
  hand-written tests using the same identity, against the same
  long-lived backend can hit the app's own overlap-detection business
  logic. This is the same class of pre-existing reference-app fragility
  already documented, not a new one — but generation doesn't yet work
  around it the way hand-written specs do.
- **A bare goal-only requirement isn't enough.** GAP does not infer login/
  navigation/field steps from a one-line business goal — say the steps
  explicitly (see above). This is intentional: inferring UI steps from a
  goal statement without a discovered basis would mean guessing.
- **`storageState`-only authentication.** No login-form-filling heuristic
  is attempted (same decision as Phase 1 discovery, for the same reasons —
  see `docs/DISCOVERY.md`).
- **One generated file per run**, one requirement, one test. Generating a
  multi-test suite from one requirement isn't supported.
- **Page/component generation is limited to reusing an existing login
  helper or inlining one from discovery.** GAP doesn't yet generate a new
  Page Object class file — every hand-written HRMS spec already uses
  `ui.click`/`ui.fill` directly rather than page objects (see
  `docs/PLATFORM.md`), so generated tests follow the same, already-
  established convention rather than introducing a second style.
