# Natural-Language Execution (Phase 1)

Run GAP by describing what you want in plain English — no Playwright
commands, no `--grep` expressions, no knowledge of the framework's folder
structure required.

```bash
npm run gap
```

```
GAP — Generic Automation Platform
Describe what you want to run in plain English, or type "exit".
Example: Run smoke tests for Leave module in QA using Chrome

GAP > Run smoke tests for Leave module in QA using Chrome

GAP interpreted your request as:

Application: HRMS Leave Management (hrms)
Environment: QA
Module:      leave
Test Type:   smoke
Browser(s):  chromium
Tags:        @smoke

Proceed? [Y/n] y

Executing...

  ✓ 1 [chromium] › applications/hrms/tests/ui/leave.spec.ts › employee can apply for leave

  1 passed (3.6s)

Report available at: reports/html-report/index.html
Run "npm run report:show" to open it.
```

## What this is — and isn't

This is an **interface layer only**. GAP > text goes through a
deterministic, keyword-based parser (no AI/LLM, no arbitrary code
execution) that turns your sentence into the exact same structured request
the CLI flags already produce — `{ application, environment, module, type,
browsers, tags }`. That request is handed to the **existing** GAP execution
engine (`resolveExecution` → Playwright) unchanged. There is no second
execution engine and no way for typed text to run anything other than a
validated test selection.

```
Your sentence
   ↓
Deterministic parser (src/core/intent/)
   ↓
Same normalized request "npm run gap:test -- --flags" produces
   ↓
resolveExecution()  ← the existing GAP engine, untouched
   ↓
Playwright
```

## What it understands

| Field       | Recognized from                                                                       |
| ----------- | ------------------------------------------------------------------------------------- |
| Application | The application's id or display name (`config/applications.json`)                     |
| Environment | `dev`/`development`, `qa`/`quality assurance`, `staging`/`stage`, `prod`/`production` |
| Module      | Any module name registered for the application                                        |
| Test type   | `smoke`, `regression`, `sanity`, `functional`                                         |
| Browser     | `chrome`/`chromium`, `firefox`, `safari`/`webkit`, or "all browsers"                  |
| Tags        | Explicit `@tag` tokens, e.g. `@hrms.leave.apply.valid`                                |

Anything not recognized is simply left out of the plan — you always see the
full interpreted plan and confirm before anything runs.

## When GAP asks instead of guessing

If a word in your sentence could mean more than one thing, GAP asks rather
than picking one for you:

```
GAP > Run smoke tests for Leave module in QA

I found multiple possible applications. Which application should I use?
  1. HRMS Leave Management (hrms)
  2. ABC Portal (abc)

Enter a number: 1
```

Your answer is combined with your original sentence and re-parsed — so if
several fields were ambiguous, GAP asks about them one at a time until the
whole request is unambiguous.

If you name something GAP doesn't recognize — a module the application
doesn't have, an unsupported browser, an unknown application — you get a
plain-English error instead of a Playwright/grep failure:

```
GAP > Run smoke tests for Payments module in QA

GAP: Application "hrms" has no module "payments". Available modules: auth, leave, approval.
```

## Phase 2 — structured input

If you'd rather not write a sentence, enter fields directly. Any line
starting with a recognized field name switches GAP into structured mode for
that request; finish the block with a blank line:

```
GAP > application: HRMS
... environment: QA
... module: Leave
... type: Smoke
... browser: Chrome
...
```

Accepted fields (aliases in parentheses): `application` (`app`),
`environment` (`env`), `module`, `type` (`testtype`/`test type`),
`browser` (`browsers`, comma-separated for more than one), `tags`
(comma-separated). Values are checked the same way natural language is —
an unrecognized value produces the same kind of plain-English error, not a
Playwright failure.

## Non-interactive use

For scripting or CI, pass the request as an argument and skip the
confirmation prompt with `--yes`:

```bash
npm run gap -- "Run smoke tests for Leave module in QA using Chrome" --yes
```

## Relationship to the CLI flags

`npm run gap` and `npm run gap:test -- --flags` (see
[docs/PLATFORM.md](./PLATFORM.md)) are two interfaces over the same
execution engine — pick whichever fits the moment. Structured manifests
(`config/execution/*.yml`) and the GitHub Actions manual-dispatch workflow
are unaffected and still work exactly as documented in
[docs/PLATFORM.md](./PLATFORM.md).
