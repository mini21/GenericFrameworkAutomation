# GAP Quickstart for Manual QA

GAP (Generic Automation Platform) turns a plain-English requirement into a
real, working Playwright test — without you writing TypeScript, learning
Playwright internals, or touching locator code. This guide is written for
someone who tests software, not someone who codes it.

## 1. What GAP is

You give GAP four things: an **application**, a **URL**, an
**environment**, and a **requirement**. GAP then:

1. Visits the application and maps out its real pages/buttons/fields (Discovery).
2. Logs in for real if the app requires it (Authentication).
3. Reads your requirement and figures out which real UI elements each step needs (Semantic Mapping).
4. Writes an actual Playwright test file that uses those elements (Generation).
5. Type-checks, lints, and **actually runs** the generated test against the real app (Validation).
6. Shows you the result and asks you to approve, edit, or reject it (Approval).
7. Once approved, saves the test and wires it into the existing requirement-coverage report (Traceability & Coverage).

If GAP can't confidently figure something out, it asks you instead of guessing.

## 2. Architecture, in one paragraph

Everything above is built on the framework's existing pieces, not a
separate system: **LocatorResolver** (the same one every hand-written test
uses — role → label → placeholder → text → test ID, self-healing, never a
silent guess) resolves every element GAP finds or generates. **Discovery**
crawls same-origin pages and re-verifies every element through that same
resolver before recording it. **Requirement Coverage** and **execution
pass rate** are two different, clearly-labeled numbers from the one
existing coverage engine — GAP never invents a second one. See
`docs/ARCHITECTURE.md` for the full picture.

## 3. Install

```bash
npm install
npx playwright install --with-deps   # Chromium/Firefox/WebKit browsers
```

Chromium is the browser GAP and CI always require to pass. Firefox/WebKit
run too, but if your machine is missing their OS-level dependencies (a
sandboxed CI runner without audio/video codec libraries, for example),
that's an environment gap, not a framework bug — you'll see a clear
"missing dependencies" error naming the exact libraries, not a mysterious
timeout.

## 4. Configure an application

Every application's connection details live in `config/applications.json`
and `config/environments/.env.<env>` — never in TypeScript source. To
point an already-onboarded application at a different environment, edit
its `.env.qa` / `.env.staging` / `.env.prod` file. Nothing else changes.

## 5. Onboard a new application

```bash
npm run gap:onboard -- \
  --id=myapp \
  --name="My Application" \
  --baseUrl=https://myapp-qa.company.com \
  --apiBaseUrl=https://api.myapp-qa.company.com \
  --modules=auth,checkout \
  --authProfiles=employee,admin \
  --dataProfiles=qa-default \
  --startPath=/dashboard
```

This registers the application in `config/applications.json` and
scaffolds `applications/myapp/{pages,components,api,fixtures,data,
requirements,tests/ui,tests/api}` — no generic framework source file is
ever edited to add an application. `--startPath` is optional: set it once
for an app whose home route isn't `/` (e.g. one that 404s at the root and
needs discovery/generation to start at `/dashboard` or `/login` instead),
and every future discovery/generate call for that app uses it automatically.

## 6. Discover an application

```bash
npm run gap:discover -- --application=hrms --url=http://localhost:4100/login.html
```

Writes `applications/hrms/discovery/application-map.json` — a real record
of every page, button, input, link, and route GAP actually found and
verified, never invented. If the app needs a login first, either pass
`--storage-state=<path-to-a-captured-session.json>`, or do nothing —
if the application has a registered credential profile (see the
Authentication section below), GAP detects the login form and logs in for
real before continuing discovery. See `docs/DISCOVERY.md` for the full flag
reference.

## 7. Generate automation from a requirement

The simplest way — interactively:

```bash
npm run gap
```

```
GAP > Create automation for HRMS at http://localhost:4100/login.html in QA.

GAP: generating automation for "hrms"...
[... discovery, mapping, generation, validation ...]

--------------------------------
GENERATED AUTOMATION
--------------------------------
[... requirement, steps, locators, validation results ...]
--------------------------------

[A]pprove / [E]dit / [R]eject:
```

Or non-interactively:

```bash
npm run gap:generate -- \
  --application=hrms --environment=qa \
  --url=http://localhost:4100/login.html \
  --requirement-file=requirement.txt \
  --approve
```

Where `requirement.txt` looks like:

```
Employee should be able to apply leave.

Steps:
1. Login as employee.
2. Open Apply Leave.
3. Select start and end dates.
4. Fill Reason as "Family trip".
5. Submit the leave request.
6. Verify "Leave application submitted successfully" is displayed.
```

Each step must describe a concrete action — GAP never invents business
behavior from a vague requirement. If a step is ambiguous (two discovered
pages/fields plausibly match), GAP shows you the real candidates it found
and asks you to pick one, rather than guessing.

## 8. Execute tests

Generated and hand-written tests both run the same way — through the
execution engine, which resolves the right `BASE_URL` for the
application you name:

```bash
npm run gap:test -- --application=hrms --environment=qa --tags=@smoke
```

You can also run a spec file directly with `npx playwright test <file>`
— GAP infers the application from the file's own path
(`applications/<id>/tests/...`) and resolves the correct URL
automatically, the same way `gap:test` does.

## 9. Authentication setup

GAP never hardcodes credentials. It supports, in order of precedence:

1. An explicit `--storage-state=<path>` (a Playwright session file you capture once, e.g. via `npx playwright codegen --save-storage=state.json <url>`).
2. A registered credential profile: `applications/<app>/data/<profile>.json` (referenced by `--authProfiles`/`--dataProfiles` at onboarding time) — GAP detects a real login form during discovery and logs in for real using it.
3. A reusable, hand-written login helper (`applications/<app>/fixtures/*-auth.ts`, e.g. `loginAsHrmsUser`) — generated tests call this directly, the same helper your hand-written tests already use.

Credentials are never printed, never written into generated test code
(generated tests reference `profile.employee`, never a literal value),
never included in reports, and — because `applications/<app>/data/*.json`
holds only fixture/test credentials for local reference apps — never
committed as real secrets.

## 10. Locator Intelligence

Every element GAP resolves — during discovery, mapping, or a running
test — goes through the same `LocatorResolver`: role → label →
placeholder → text → test ID, each checked for uniqueness, visibility,
and usability before being accepted. If a locator has drifted and a
different strategy in the chain finds it, that's reported as **self-healed**
— logged and attached to the test report, never silently hidden. See
`docs/LOCATOR-INTELLIGENCE.md`.

## 11. Requirement traceability & coverage

Every approved generated test is automatically:

- Recorded in `applications/<app>/requirements/requirements.json` with a stable requirement ID and a matching test tag (`@requirement.LEAVE-007`, `@hrms.leave.generated.3`).
- Picked up by the existing coverage engine — no second one.

```bash
npm run coverage:report
```

reports **Requirement Coverage** (how many requirements have an automated
test) and **Execution Pass Rate** (how many of the tests that ran,
passed) as two separate, clearly-labeled numbers — never mixed into one.

## 12. Reporting

```bash
npm run report:show                 # HTML report (screenshots, traces, locator healing)
npm run report:allure:generate && npm run report:allure:open   # Allure
```

JUnit XML is written to `reports/junit/results.xml` for CI test-result panels.

## 13. Troubleshooting

| Symptom                                               | What it means                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Application configuration was not found for X"       | `X` isn't in `config/applications.json` — onboard it first.                                                                                         |
| Discovery blocked with "zero buttons/inputs/links..." | The start path 404s or needs authentication — pass `--start-path`/`--storage-state`, or register `startPath`/an auth profile at onboarding.         |
| A step reported "no verified [...] element"           | GAP found no confident match and refused to guess — check the `--diagnose` output for the exact candidates it considered and why each was rejected. |
| WebKit/Firefox failing with "missing dependencies"    | A host environment gap, not a framework bug — install the named OS libraries or run Chromium only.                                                  |

See `docs/TROUBLESHOOTING.md` for the full list.

## 14. Adding another application

Repeat step 5 (`gap:onboard`) with the new application's own id/URL/
modules/profiles. Nothing in `src/core/` or `playwright.config.ts` needs
to change — every generic piece (discovery, mapping, generation,
execution, coverage, reporting) already works per-application.

## 15. How developers can extend the framework

- **New test type** (e.g. a load-testing pipeline): see "Extending to a
  new test type" in `docs/ARCHITECTURE.md` — one `testMatch`/project
  addition, then every application's specs for that type need zero core
  changes.
- **New application-specific auth helper**: add
  `applications/<app>/fixtures/<name>-auth.ts` exporting an
  `async function loginAsXxx(page, ui, credential)` — GAP's generator
  detects and reuses it automatically, the same way it already does for HRMS.
- Full architectural rationale: `docs/ARCHITECTURE.md`. Discovery internals: `docs/DISCOVERY.md`. Generation internals: `docs/GENERATION.md`. Locator Intelligence: `docs/LOCATOR-INTELLIGENCE.md`.
