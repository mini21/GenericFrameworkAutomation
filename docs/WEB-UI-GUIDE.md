# GAP Web UI — Guide for Manual QA

GAP's web UI lets you create, run, and review automated tests from your
browser — no terminal, no Node/npm/Playwright knowledge, no test code
required.

## Starting the UI

Someone with terminal access (once) runs:

```
npm run gap:ui
```

You'll see:

```
GAP — Generic Automation Platform (web UI)
Open http://localhost:4300 in a browser.
```

Open that address in your browser. Everything from here on is done in the
browser — no further terminal commands are needed.

(The port can be changed by setting `GAP_UI_PORT` before starting, e.g.
`GAP_UI_PORT=5000 npm run gap:ui`.)

## Creating a test

On the **New Test** tab, fill in:

- **Application URL** — the app you want to test, e.g. `https://www.amazon.com`.
- **Requirement** — one sentence describing what should work, e.g. "User
  should be able to search for a product."
- **Test Steps** (optional) — the individual actions, one per line, e.g.:
  ```
  Enter "laptop" in the search box.
  Submit the search.
  Verify that search results are displayed.
  ```
  Tip: describe things using the words actually visible on the page (a
  button's own label, a field's own name) — GAP matches your wording
  against what it finds on the page, it never guesses.
- **Environment** and **Browser** — leave these on the defaults unless you
  have a reason to change them.

Click **Generate & Test**.

## Live progress

You'll see a checklist update in real time as GAP works:

```
✓ Connecting to application
✓ Discovering application
✓ Mapping pages and elements
✓ Understanding requirement
✓ Generating automation
✓ Validating automation
→ Waiting for approval
```

## If GAP needs more information

Sometimes GAP can't safely guess something on its own — it will never
invent a value or pick a random match. Instead you'll see a card, e.g.:

> I need a value for "reason".
> `[ family vacation ]` `[ Continue ]`

or, when more than one element on the page could match what you
described:

> I found 3 possible matches for "Submit the search".
> (each option shown with why it matched)

Pick the right one, or — if none of the options are genuinely the right
element — choose **None of these — skip**. GAP will never guess for you;
if nothing can be resolved, it reports that clearly instead of generating
something that might be wrong.

## Reviewing the generated test

Once generation succeeds, you'll see the test GAP built, as plain steps:

```
1. Enter "laptop" in the search box
2. Submit the search
3. Verify search results are displayed
```

Two optional expandable sections give more detail for technical
reviewers: **Show confidence & locator details** (how confidently each
step matched, and exactly what it matched) and **View generated code**
(the real test file, for anyone who wants to read the underlying
TypeScript/Playwright code — never required reading).

From here:

- **Approve & Run** — saves the test and runs it immediately.
- **Reject** — discards it, nothing is saved.
- **Edit** — takes you back to the requirement/steps to try different
  wording (GAP never asks you to hand-edit generated code).

## Execution and result

After approving, GAP runs the real test against the real application and
streams a live log. You'll land on a clear result:

```
TEST PASSED
1 / 1 passed · 4.2 seconds
```

or, on failure:

```
TEST FAILED
1 / 1 passed... (a plain-English summary of what went wrong)
```

with links to **View Report**, **View Trace**, and **Download Report** —
and a **Technical Details** section for anyone who wants the raw output.
GAP never shows a raw stack trace as the primary failure message.

## Applications and Test History

- **Applications** — every application GAP has been used against, with
  its last result and overall pass rate.
- **Test History** — every test run through this UI: date, application,
  requirement, status, duration, and the test's own stable ID, so you can
  find and re-check any past run.

## What the web UI does NOT change

The web UI is an additional way to use GAP — it calls the exact same
discovery/generation/execution/reporting engine the command-line tools
(`npm run gap`, `npm run gap:test`, `npm run gap:discover`, `npm run
gap:generate`) already use. Nothing about those commands changes; a test
generated from the browser can be re-run from the terminal (and vice
versa) using the same stable test ID shown after approval.
