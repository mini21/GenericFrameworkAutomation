import { test, expect } from '../../src/core/fixtures/base.fixture';
import { mapPage } from '../../src/core/discovery/page-crawler';
import { mapRequirementToUI } from '../../src/core/generation/ui-mapper';
import { RawStep } from '../../src/core/generation/generation-types';
import { TAGS } from '../../src/core/constants';

// The user's own worked example of genuine, business-meaningful ambiguity:
// two DIFFERENT forms on the same page, each with an identically-named
// "Submit" button (e.g. "Employee form" vs "Manager form"). Before this,
// page-crawler.ts's own dedup collapsed the two into ONE DiscoveredElement
// (keyed by `${role}::${name}` alone) — a Manual QA could never even be
// asked which one was meant, and if somehow surfaced, both candidates would
// have rendered as visually identical entries with nothing to tell them
// apart. Nothing here is app-specific — "Employee"/"Manager" are the
// user's own example labels, exercised purely through the generic
// aria-label/legend/name/heading signals collectFormContext reads.
const TWO_FORMS_HTML = `
<!DOCTYPE html>
<html>
<head><title>Two forms fixture</title></head>
<body>
  <h1>Leave Requests</h1>

  <form aria-label="Employee form">
    <label for="emp-reason">Reason</label>
    <input id="emp-reason" name="reason" type="text" />
    <button type="submit">Submit</button>
  </form>

  <form aria-label="Manager form">
    <label for="mgr-comment">Comment</label>
    <input id="mgr-comment" name="comment" type="text" />
    <button type="submit">Submit</button>
  </form>
</body>
</html>
`;

test.beforeEach(async ({ page }) => {
  await page.setContent(TWO_FORMS_HTML);
});

test.describe(`Application Discovery — form-level context ${TAGS.SMOKE}`, () => {
  test('two forms sharing an identically-named Submit button are individuated, not collapsed into one', async ({
    page,
  }) => {
    const map = await mapPage(page);
    const submits = map.buttons.filter((b) => b.name === 'Submit');
    expect(submits).toHaveLength(2);

    const labels = submits.map((s) => s.formLabel).sort();
    expect(labels).toEqual(['Employee form', 'Manager form']);

    // Each occurrence is independently, uniquely verified — scoped to ITS
    // OWN form (see LocatorIntent.scope) — not left unverified merely
    // because a same-named sibling exists elsewhere on the page.
    for (const submit of submits) {
      expect(submit.verified).toBeDefined();
      expect(submit.formIndex).toBeDefined();
    }
    expect(submits[0].formIndex).not.toBe(submits[1].formIndex);
  });

  test('a single-form page never sets formLabel/formIndex on anything — zero behavior change for the common case', async ({
    page,
  }) => {
    await page.setContent(`
      <!DOCTYPE html><html><body>
        <form><button type="submit">Submit</button></form>
      </body></html>
    `);
    const map = await mapPage(page);
    const submit = map.buttons.find((b) => b.name === 'Submit');
    expect(submit?.formLabel).toBeUndefined();
    expect(submit?.formIndex).toBeUndefined();
  });

  test('the ambiguity card for a genuinely ambiguous cross-form Submit shows form identity, not two identical entries', async ({
    page,
  }) => {
    const crawled = await mapPage(page);
    const map = {
      application: 'genericapp',
      baseUrl: 'http://localhost:9999',
      generatedAt: '2026-01-01T00:00:00.000Z',
      errors: [],
      pages: [crawled],
    };
    const steps: RawStep[] = [{ action: 'click', target: 'submit', raw: 'Submit the request' }];
    const [mapping] = mapRequirementToUI('genericapp', map, steps);

    // Two equally-valid native submit controls, same page, same name — a
    // real business ambiguity, correctly surfaced (never silently guessed).
    expect(mapping.confidence).toBe('MEDIUM');
    const candidates = mapping.ambiguous?.candidates ?? [];
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.formLabel).sort()).toEqual(['Employee form', 'Manager form']);
    // The candidate LABEL a Manual QA reads stays the plain control name —
    // formLabel is a separate, additive field the UI renders alongside it
    // (see server/ui/public/app.js) — but the re-parse VALUE differs per
    // candidate even though both share the same label, so a human's choice
    // is genuinely distinguishable and deterministic (see below).
    expect(candidates.map((c) => c.label)).toEqual(['Submit', 'Submit']);
    expect(candidates[0].value).not.toBe(candidates[1].value);

    // A human's disambiguation choice (re-parsed back into step.target,
    // exactly as generation-orchestrator.ts's real resolveAmbiguity flow
    // does) resolves deterministically to THAT specific form's control,
    // never re-triggering the same tie.
    const employeeChoice = candidates.find((c) => c.formLabel === 'Employee form')!;
    const resolved = mapRequirementToUI('genericapp', map, [
      { action: 'click', target: employeeChoice.value, raw: 'Submit the request' },
    ]);
    expect(resolved[0].confidence).toBe('HIGH');
    expect(resolved[0].ambiguous).toBeUndefined();
    expect(resolved[0].resolved?.formIndex).toBeDefined();
  });
});
