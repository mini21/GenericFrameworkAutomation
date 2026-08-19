// GAP web UI — a thin client over the existing GAP engine's API layer
// (server/ui/routes.ts). No automation logic lives here: every action
// below is a fetch() call into an endpoint that runs the SAME
// discovery/generation/execution/coverage code the CLI already uses.

const PHASE_ORDER = ['connecting', 'discovering', 'mapping', 'understanding', 'generating', 'validating'];
const PHASE_LABELS = {
  connecting: 'Connecting to application',
  discovering: 'Discovering application',
  mapping: 'Mapping pages and elements',
  understanding: 'Understanding requirement',
  generating: 'Generating automation',
  validating: 'Validating automation',
};

const state = {
  tab: 'home',
  screen: 'form',
  jobId: null,
  es: null,
  phaseLog: [], // [{phase, detail}]
  pendingQuestion: null,
  blockedMessage: null,
  errorMessage: null,
  outcome: null,
  // Live execution — one entry per STEP_*/ASSERTION_* event pair seen so
  // far: { index, kind: 'step'|'assertion', description, status, durationMs, error, screenshotUrl }
  steps: [],
  activityLog: [], // [{time, text}] — Manual-QA-facing phrasing only
  execStatus: null, // 'running' | 'passed' | 'failed' | 'cancelled'
  execStartedAt: null,
  execResult: null, // the final 'exec-result' event, once it arrives
  cancelling: false,
  form: { url: '', requirement: '', steps: '', environment: 'qa', browser: 'chromium' },
  applications: [],
  history: [],
};

let elapsedTimer = null;
function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    const el = document.getElementById('exec-elapsed');
    if (!el || !state.execStartedAt) {
      stopElapsedTimer();
      return;
    }
    el.textContent = `${((Date.now() - state.execStartedAt) / 1000).toFixed(1)}s`;
  }, 100);
}
function stopElapsedTimer() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function formatDuration(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function stepSymbol(status) {
  if (status === 'passed') return '✓';
  if (status === 'running') return '●';
  if (status === 'failed') return '✕';
  if (status === 'skipped') return '⊘';
  return '○';
}

function logActivity(text) {
  state.activityLog.push({ time: new Date().toLocaleTimeString(), text });
}

function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${url}" alt="Step screenshot" />`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

const app = document.getElementById('app');

async function api(path, options) {
  const res = await fetch(path, {
    method: options?.method || 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed (${res.status})`);
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res.text();
}

function esc(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.tab = btn.dataset.tab;
    if (state.tab === 'home') resetJobState();
    if (state.tab === 'applications') loadApplications();
    if (state.tab === 'history') loadHistory();
    render();
  });
});

function resetJobState() {
  if (state.es) state.es.close();
  stopElapsedTimer();
  Object.assign(state, {
    screen: 'form',
    jobId: null,
    es: null,
    phaseLog: [],
    pendingQuestion: null,
    blockedMessage: null,
    errorMessage: null,
    outcome: null,
    steps: [],
    activityLog: [],
    execStatus: null,
    execStartedAt: null,
    execResult: null,
    cancelling: false,
  });
}

// ---------------------------------------------------------------------------
// Render dispatch
// ---------------------------------------------------------------------------

function render() {
  if (state.tab === 'applications') return renderApplications();
  if (state.tab === 'history') return renderHistory();
  if (state.screen === 'form') return renderForm();
  if (state.screen === 'progress') return renderProgress();
  if (state.screen === 'blocked') return renderBlocked();
  if (state.screen === 'review') return renderReview();
  if (state.screen === 'executing') return renderExecuting();
  if (state.screen === 'result') return renderResult();
}

// ---------------------------------------------------------------------------
// Screen: form
// ---------------------------------------------------------------------------

function renderForm() {
  app.innerHTML = `
    <div class="card">
      <h1>Create a new test</h1>
      <p class="subtitle">Describe what should work, in plain English — GAP discovers the application, generates the automation, and runs it for you.</p>

      <label>Application URL</label>
      <input type="url" id="f-url" placeholder="https://www.amazon.com" value="${esc(state.form.url)}" />

      <label>Requirement</label>
      <textarea id="f-requirement" placeholder="User should be able to search for a product.">${esc(state.form.requirement)}</textarea>

      <label>Test Steps <span class="hint">(optional — one per line)</span></label>
      <textarea id="f-steps" placeholder='Enter "laptop" in the search box.
Submit the search.
Verify that search results are displayed.'>${esc(state.form.steps)}</textarea>

      <div class="row">
        <div>
          <label>Environment</label>
          <select id="f-environment">
            ${['qa', 'dev', 'staging', 'prod'].map((e) => `<option value="${e}" ${state.form.environment === e ? 'selected' : ''}>${e.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Browser</label>
          <select id="f-browser">
            ${['chromium', 'firefox', 'webkit'].map((b) => `<option value="${b}" ${state.form.browser === b ? 'selected' : ''}>${b[0].toUpperCase() + b.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="btn-generate">Generate &amp; Test</button>
      </div>
      ${state.errorMessage ? `<div class="error-banner" style="margin-top:16px">${esc(state.errorMessage)}</div>` : ''}
    </div>
  `;

  document.getElementById('btn-generate').addEventListener('click', onGenerateClick);
}

async function onGenerateClick() {
  state.form.url = document.getElementById('f-url').value.trim();
  state.form.requirement = document.getElementById('f-requirement').value.trim();
  state.form.steps = document.getElementById('f-steps').value;
  state.form.environment = document.getElementById('f-environment').value;
  state.form.browser = document.getElementById('f-browser').value;

  if (!state.form.url || !state.form.requirement) {
    state.errorMessage = 'Application URL and Requirement are both required.';
    render();
    return;
  }
  state.errorMessage = null;

  try {
    const { jobId } = await api('/api/generate', { method: 'POST', body: state.form });
    state.jobId = jobId;
    state.screen = 'progress';
    state.phaseLog = [];
    render();
    connectToJob(jobId);
  } catch (err) {
    state.errorMessage = err.message;
    render();
  }
}

// ---------------------------------------------------------------------------
// SSE connection — one EventSource per job, replayed from the start so a
// browser refresh mid-job still shows the full timeline.
// ---------------------------------------------------------------------------

function connectToJob(jobId) {
  const es = new EventSource(`/api/jobs/${jobId}/events`);
  state.es = es;
  es.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    handleJobEvent(event);
  };
}

function handleJobEvent(event) {
  if (event.type === 'phase') {
    state.phaseLog.push({ phase: event.phase, detail: event.detail });
  } else if (event.type === 'question') {
    state.pendingQuestion = event;
  } else if (event.type === 'ready-for-approval') {
    state.outcome = event.outcome;
    state.pendingQuestion = null;
    state.screen = 'review';
  } else if (event.type === 'blocked') {
    state.blockedMessage = event.message;
    state.pendingQuestion = null;
    state.screen = 'blocked';
  } else if (event.type === 'rejected') {
    resetJobState();
  } else if (event.type === 'approved') {
    state.screen = 'executing';
    state.steps = [];
    state.activityLog = [];
    state.execStatus = 'running';
    state.execStartedAt = Date.now();
    state.execResult = null;
    state.cancelling = false;
    startElapsedTimer();
    logActivity('Starting the test');
  } else if (event.type === 'live-event') {
    handleLiveEvent(event.event);
  } else if (event.type === 'exec-result') {
    stopElapsedTimer();
    state.execResult = event;
    state.execStatus = event.passed ? 'passed' : 'failed';
    state.screen = 'result';
  } else if (event.type === 'error') {
    stopElapsedTimer();
    state.errorMessage = event.message;
    state.screen = 'blocked';
    state.blockedMessage = event.message;
  }
  render();
}

// A generated test's step description IS the requirement's own wording
// (see code-generator.ts's liveStep(step.step.raw, ...)) — never a
// locator/selector — so it is already Manual-QA-friendly as-is; no
// separate translation table is needed here.
function handleLiveEvent(e) {
  if (e.type === 'STEP_STARTED' || e.type === 'ASSERTION_STARTED') {
    state.steps.push({
      index: e.stepIndex,
      kind: e.type === 'ASSERTION_STARTED' ? 'assertion' : 'step',
      description: e.stepDescription || '',
      status: 'running',
      durationMs: null,
      error: null,
      screenshotUrl: null,
    });
    logActivity(e.stepDescription || '');
    return;
  }
  if (
    e.type === 'STEP_PASSED' ||
    e.type === 'STEP_FAILED' ||
    e.type === 'ASSERTION_PASSED' ||
    e.type === 'ASSERTION_FAILED'
  ) {
    const step = state.steps.find((s) => s.index === e.stepIndex);
    if (step) {
      step.status = e.status === 'passed' ? 'passed' : 'failed';
      step.durationMs = e.durationMs ?? null;
      step.error = e.error || null;
      step.screenshotUrl = e.screenshotPath ? `/api/jobs/${state.jobId}/screenshots/${e.stepIndex}` : null;
    }
    const verb = e.status === 'passed' ? '✓ Done' : '✕ Failed';
    logActivity(`${verb}: ${e.stepDescription || ''}${e.durationMs != null ? ` (${formatDuration(e.durationMs)})` : ''}`);
    return;
  }
  if (e.type === 'TEST_CANCELLED' || e.type === 'RUN_CANCELLED') {
    if (state.execStatus === 'cancelled') return; // TEST_CANCELLED then RUN_CANCELLED both arrive for a graceful cancel — handle once
    stopElapsedTimer();
    // Any step still shown as "running" never got to finish — reflect
    // that as skipped rather than leaving a stale spinner on screen.
    state.steps.forEach((s) => {
      if (s.status === 'running') s.status = 'skipped';
    });
    state.execStatus = 'cancelled';
    state.execResult = { passed: false, total: 1, passedCount: 0, durationMs: Date.now() - (state.execStartedAt || Date.now()) };
    state.screen = 'result';
    logActivity('Test cancelled');
  }
}

// ---------------------------------------------------------------------------
// Screen: progress (timeline + optional question card)
// ---------------------------------------------------------------------------

function renderProgress() {
  const reached = new Set(state.phaseLog.map((p) => p.phase));
  const latest = state.phaseLog.length ? state.phaseLog[state.phaseLog.length - 1].phase : null;

  const items = PHASE_ORDER.map((phase) => {
    const cls = state.outcome || reached.has(phase) ? (phase === latest && !state.outcome ? 'active' : 'done') : '';
    const entry = state.phaseLog.find((p) => p.phase === phase);
    const mark = cls === 'done' ? '✓' : cls === 'active' ? '…' : '';
    return `<li class="${cls}"><span class="mark">${mark}</span> ${PHASE_LABELS[phase]}${entry?.detail ? ` <span class="detail">— ${esc(entry.detail)}</span>` : ''}</li>`;
  });

  const awaitingApproval = !!state.outcome;
  items.push(
    `<li class="${awaitingApproval ? 'active' : ''}"><span class="mark">${awaitingApproval ? '→' : ''}</span> Waiting for approval</li>`,
  );

  app.innerHTML = `
    <div class="card">
      <h1>Generating your automation</h1>
      <p class="subtitle">Working with the application you gave us — this usually takes under a minute.</p>
      <ul class="timeline">${items.join('')}</ul>
      <div id="question-slot"></div>
    </div>
  `;

  if (state.pendingQuestion) renderQuestionCard(state.pendingQuestion);
}

// A candidate carrying real structural context (which page it lives on,
// its relationship to the preceding step's own resolved element) renders
// that context as labeled lines instead of just a bare name — the fix for
// "N visually identical choices" when several discovered elements share an
// accessible name (e.g. a site-wide header control repeated on every
// page). Purely additive: a candidate with none of these optional fields
// (any other kind of ambiguity) still renders exactly as before.
function renderCandidateCard(c, index) {
  const contextLines = [
    c.elementType
      ? `<div class="candidate-ctx"><strong>Element:</strong> ${esc(c.elementType)}</div>`
      : '',
    c.pageName ? `<div class="candidate-ctx"><strong>Page:</strong> ${esc(c.pageName)}</div>` : '',
    c.pageUrl ? `<div class="candidate-ctx"><strong>URL:</strong> ${esc(c.pageUrl)}</div>` : '',
    c.relationship
      ? `<div class="candidate-ctx"><strong>Relationship:</strong> ${esc(c.relationship)}</div>`
      : '',
    c.matchConfidence
      ? `<div class="candidate-ctx"><strong>Confidence:</strong> ${esc(c.matchConfidence)}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  return `
    <div class="candidate" data-index="${index}">
      <div>
        <div class="label">${esc(c.label)}</div>
        <div class="desc">${esc(c.description)}</div>
        ${contextLines}
      </div>
    </div>`;
}

function renderQuestionCard(question) {
  const slot = document.getElementById('question-slot');
  if (question.kind === 'ambiguity' && question.candidates?.length) {
    slot.innerHTML = `
      <div class="question-card">
        <h3>${esc(question.prompt)}</h3>
        ${question.candidates.map((c, i) => renderCandidateCard(c, i)).join('')}
        <div class="btn-row">
          <button class="btn btn-secondary" id="q-skip">None of these — skip</button>
        </div>
      </div>
    `;
    slot.querySelectorAll('.candidate').forEach((el) => {
      el.addEventListener('click', () => {
        const candidate = question.candidates[Number(el.dataset.index)];
        answerQuestion(question.questionId, candidate.value);
      });
    });
    document.getElementById('q-skip').addEventListener('click', () => answerQuestion(question.questionId, ''));
  } else {
    slot.innerHTML = `
      <div class="question-card">
        <h3>${esc(question.prompt)}</h3>
        <input type="text" id="q-value" placeholder="Type an answer…" />
        <div class="btn-row">
          <button class="btn btn-primary" id="q-continue">Continue</button>
        </div>
      </div>
    `;
    document.getElementById('q-continue').addEventListener('click', () => {
      const value = document.getElementById('q-value').value.trim();
      answerQuestion(question.questionId, value);
    });
  }
}

async function answerQuestion(questionId, value) {
  state.pendingQuestion = null;
  render();
  await api(`/api/jobs/${state.jobId}/answer`, { method: 'POST', body: { questionId, value } });
}

// ---------------------------------------------------------------------------
// Screen: blocked (generation could not proceed)
// ---------------------------------------------------------------------------

function renderBlocked() {
  const friendly = summarizeBlockedMessage(state.blockedMessage || '');
  app.innerHTML = `
    <div class="card">
      <div class="error-banner">${esc(friendly)}</div>
      <details>
        <summary>Show technical details</summary>
        <pre>${esc(state.blockedMessage || '')}</pre>
      </details>
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-back">Start a new test</button>
      </div>
    </div>
  `;
  document.getElementById('btn-back').addEventListener('click', () => {
    resetJobState();
    render();
  });
}

// Playwright's own step error text is technical by construction — locator
// syntax, stack frames, `page.`/`expect(` calls — exactly what the "never
// show a locator/stack trace on the main screen" rule forbids. The FULL
// text is always still available via Technical Details below; this only
// decides what's safe to show inline.
function plainEnglishReason(error) {
  if (!error) return 'The test did not complete as expected.';
  const firstLine = error.split('\n')[0].trim();
  const looksTechnical = /getBy|page\.|locator|Error:|expect\(/i.test(firstLine);
  if (looksTechnical || firstLine.length > 160) {
    return 'This step did not complete as expected — see Technical Details for the full error.';
  }
  return firstLine;
}

function summarizeBlockedMessage(message) {
  const firstLine = message.split('\n')[0];
  return firstLine.length > 220 ? `${firstLine.slice(0, 220)}…` : firstLine;
}

// ---------------------------------------------------------------------------
// Screen: review (generated test, pre-approval)
// ---------------------------------------------------------------------------

function confidenceBadge(step) {
  const level = (step.confidence || 'LOW').toLowerCase();
  return `<span class="badge badge-${level}">${step.confidence}</span>`;
}

function describeStep(mapping) {
  const raw = mapping.step.raw;
  if (mapping.resolved) return raw;
  if (mapping.unmapped) return `${raw} — could not be resolved`;
  return raw;
}

// A resolved step whose diagnostics considered more than one candidate was
// auto-resolved by the confidence policy (see ui-mapper.ts), not just
// trivially the only option — surface WHY the winner won, generically, for
// any step kind (never assumes it's a verify/live-region case). A step
// with zero or one candidate considered just shows the plain locator info
// as before.
function renderStepDiagnostic(m, i) {
  const header = `<strong>${i + 1}. ${esc(m.step.raw)}</strong><br/>`;
  if (!m.resolved) {
    return `<div style="margin-bottom:10px">${header}${m.unmapped ? esc(m.unmapped.reason) : ''}</div>`;
  }
  const locatorLine = `Strategy: ${esc(m.resolved.strategy || m.resolved.kind)} · Locator: <code>${esc(m.resolved.resolvedLocator || m.resolved.description)}</code>`;
  const others = (m.diagnostics || []).filter((d) => !d.selected);
  const winner = (m.diagnostics || []).find((d) => d.selected);
  // Every HIGH-confidence resolution — not just ones that beat out other
  // candidates — shows what it resolved to, generically, for any step
  // kind: a single-candidate happy path (no competing candidates even
  // considered, since page/context filtering already narrowed the pool
  // before scoring) is just as much "figure this out yourself, don't
  // interrupt the workflow" as beating out visible alternatives.
  const summaryLines = [
    winner?.elementType ? `<strong>Element:</strong> ${esc(winner.elementType)}` : '',
    winner?.pageName ? `<strong>Page:</strong> ${esc(winner.pageName)}` : '',
    `<strong>Confidence:</strong> ${esc(winner?.matchConfidence || 'High')}`,
  ]
    .filter(Boolean)
    .join('<br/>');
  const whyLines =
    others.length > 0 && winner?.reasons?.length
      ? `<div style="margin-top:6px">${others.length} other candidate${others.length === 1 ? '' : 's'} considered and ruled out:<ul>${winner.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
      : '';
  const autoResolvedNote = `
      <div class="auto-resolved-note">
        <div>✓ Automatically resolved</div>
        <div style="margin-top:4px">${summaryLines}</div>
        ${whyLines}
      </div>`;
  return `<div style="margin-bottom:10px">${header}${locatorLine}${autoResolvedNote}</div>`;
}

function renderReview() {
  const outcome = state.outcome;
  const spec = outcome.spec;
  app.innerHTML = `
    <div class="card">
      <h1>Review generated test</h1>
      <p class="subtitle">GAP discovered the application and generated a real, executable test for this requirement.</p>

      <label>Requirement</label>
      <div>${esc(spec.requirementText)}</div>

      <h2 style="margin-top:24px">Generated Test — ${esc(spec.testName)}</h2>
      <ol class="step-list">
        ${spec.steps
          .map(
            (m, i) => `<li><span class="step-num">${i + 1}</span>${esc(describeStep(m))} ${confidenceBadge(m)}</li>`,
          )
          .join('')}
      </ol>

      <details>
        <summary>Show confidence &amp; locator details</summary>
        ${spec.steps.map((m, i) => renderStepDiagnostic(m, i)).join('')}
      </details>

      <details>
        <summary>View generated code</summary>
        <pre id="code-view">Loading…</pre>
      </details>

      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-edit">Edit</button>
        <button class="btn btn-danger" id="btn-reject">Reject</button>
        <button class="btn btn-primary" id="btn-approve">Approve &amp; Run</button>
      </div>
    </div>
  `;

  document.getElementById('btn-approve').addEventListener('click', async () => {
    await api(`/api/jobs/${state.jobId}/approve`, {
      method: 'POST',
      body: { environment: state.form.environment, browser: state.form.browser },
    });
  });
  document.getElementById('btn-reject').addEventListener('click', async () => {
    await api(`/api/jobs/${state.jobId}/reject`, { method: 'POST' });
  });
  document.getElementById('btn-edit').addEventListener('click', () => {
    // Editing generated TypeScript isn't something a Manual QA needs to do —
    // "Edit" takes them back to the requirement/steps they wrote instead.
    resetJobState();
    state.screen = 'form';
    render();
  });

  const codeEl = document.getElementById('code-view');
  api(`/api/jobs/${state.jobId}/code`)
    .then((data) => {
      codeEl.textContent = `// ${data.filePath}\n\n${data.code}`;
    })
    .catch(() => {
      codeEl.textContent = 'Could not load generated code.';
    });
}

// ---------------------------------------------------------------------------
// Screen: executing — a live, structured view of a real Playwright run.
// Every field here comes from the GAP_LIVE_EVENT protocol (live-events.ts)
// forwarded verbatim over SSE — nothing on this screen is guessed or
// derived from console text.
// ---------------------------------------------------------------------------

function renderExecuting() {
  const latestShot = [...state.steps].reverse().find((s) => s.screenshotUrl);
  const requirementText = state.outcome?.spec?.requirementText || state.form.requirement;

  app.innerHTML = `
    <div class="card exec-card">
      <div class="exec-header">
        <h1>Running your test</h1>
        <span class="status-pill running">Running</span>
        <span class="elapsed" id="exec-elapsed">0.0s</span>
      </div>
      <p class="subtitle">${esc(requirementText)}</p>

      <div class="exec-body">
        <div class="exec-timeline-col">
          <ol class="exec-timeline">
            ${state.steps.map(renderStepRow).join('') || '<li class="exec-step-empty">Starting…</li>'}
          </ol>
        </div>
        <div class="exec-preview-col">
          <div class="preview-label">Live Execution Preview</div>
          <div class="preview-frame" id="preview-frame">
            ${latestShot ? `<img src="${latestShot.screenshotUrl}" alt="Latest step screenshot" />` : '<div class="preview-empty">Waiting for the first screenshot…</div>'}
          </div>
        </div>
      </div>

      <div class="activity-log" id="activity-log">
        ${state.activityLog.map((a) => `<div><span class="log-time">${esc(a.time)}</span> ${esc(a.text)}</div>`).join('')}
      </div>

      <div class="btn-row">
        <button class="btn btn-danger" id="btn-cancel" ${state.cancelling ? 'disabled' : ''}>${state.cancelling ? 'Cancelling…' : 'Cancel Test'}</button>
      </div>
    </div>
  `;

  const previewFrame = document.getElementById('preview-frame');
  if (latestShot) {
    previewFrame.style.cursor = 'pointer';
    previewFrame.addEventListener('click', () => openLightbox(latestShot.screenshotUrl));
  }
  app.querySelectorAll('.step-shot-btn').forEach((btn) => {
    btn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      openLightbox(btn.dataset.url);
    });
  });

  const activityLog = document.getElementById('activity-log');
  if (activityLog) activityLog.scrollTop = activityLog.scrollHeight;

  document.getElementById('btn-cancel').addEventListener('click', onCancelClick);
  startElapsedTimer();
}

function renderStepRow(step) {
  const durationText = step.durationMs != null ? ` <span class="step-duration">${formatDuration(step.durationMs)}</span>` : '';
  const shotBtn = step.screenshotUrl
    ? `<button class="step-shot-btn" data-url="${step.screenshotUrl}">[Screenshot]</button>`
    : '';
  return `<li class="exec-step ${step.status}">
    <span class="exec-step-mark">${stepSymbol(step.status)}</span>
    <span class="exec-step-desc">${esc(step.description)}</span>${durationText}
    ${shotBtn}
  </li>`;
}

async function onCancelClick() {
  if (!confirm('Stop this test run? This cannot be undone.')) return;
  state.cancelling = true;
  render();
  try {
    await api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST' });
  } catch (err) {
    state.cancelling = false;
    state.errorMessage = err.message;
    render();
  }
}

// ---------------------------------------------------------------------------
// Screen: result — passed / failed / cancelled, per the exact mockups in
// the live-execution spec. The failing step + plain-English reason come
// straight from the same step list the timeline above already built; no
// separate error-summarization pass over console output.
// ---------------------------------------------------------------------------

function renderResult() {
  if (state.execStatus === 'cancelled') return renderCancelledResult();
  const r = state.execResult;
  const pass = r.passed;
  const requirementText = state.outcome?.spec?.requirementText || state.form.requirement;
  const failingStep = state.steps.find((s) => s.status === 'failed');
  const passedSteps = state.steps.filter((s) => s.status === 'passed').length;

  app.innerHTML = `
    <div class="result-banner ${pass ? 'pass' : 'fail'}">
      <div class="title">${pass ? '✓ TEST PASSED' : '✕ TEST FAILED'}</div>
      <div class="stat">${r.passedCount} / ${r.total} tests passed · Steps: ${passedSteps} / ${state.steps.length} passed · Duration: ${(r.durationMs / 1000).toFixed(1)} seconds</div>
    </div>
    <div class="card">
      <p class="subtitle">${esc(requirementText)}</p>
      ${
        pass
          ? ''
          : `
        <div class="error-banner">
          <strong>${esc(failingStep?.description || 'A step failed')}</strong><br/>
          ${esc(plainEnglishReason(failingStep?.error))}
        </div>
      `
      }
      <div class="link-row">
        ${!pass && failingStep?.screenshotUrl ? `<button class="btn btn-secondary" id="btn-view-shot">View Screenshot</button>` : ''}
        ${pass ? `<button class="btn btn-secondary" id="btn-view-shots">View Screenshots</button>` : ''}
        <a class="btn btn-secondary" href="/reports/html-report/index.html" target="_blank">${pass ? 'View Report' : 'View Video'}</a>
        <a class="btn btn-secondary" href="/reports/html-report/index.html" target="_blank">View Trace</a>
        <button class="btn btn-secondary" id="btn-tech-details">Technical Details</button>
        <button class="btn btn-primary" id="btn-run-again">Run Again</button>
      </div>
      <div id="shots-gallery" class="shots-gallery" hidden>
        ${state.steps
          .filter((s) => s.screenshotUrl)
          .map((s) => `<img src="${s.screenshotUrl}" data-url="${s.screenshotUrl}" alt="${esc(s.description)}" title="${esc(s.description)}" />`)
          .join('')}
      </div>
      <details id="tech-details-panel" style="margin-top:16px" hidden>
        <summary>Technical Details</summary>
        <pre id="tech-details-content">Loading…</pre>
      </details>
    </div>
  `;

  document.getElementById('btn-view-shot')?.addEventListener('click', () => openLightbox(failingStep.screenshotUrl));
  document.getElementById('btn-view-shots')?.addEventListener('click', () => {
    const gallery = document.getElementById('shots-gallery');
    gallery.hidden = !gallery.hidden;
  });
  app.querySelectorAll('#shots-gallery img').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.dataset.url));
  });
  document.getElementById('btn-tech-details').addEventListener('click', () => {
    const panel = document.getElementById('tech-details-panel');
    panel.hidden = !panel.hidden;
    panel.open = true;
    if (!panel.dataset.loaded) {
      panel.dataset.loaded = '1';
      api(`/api/jobs/${state.jobId}/output`)
        .then((data) => {
          const stepDetail = failingStep
            ? `Failing step: ${failingStep.description}\n\n${failingStep.error || ''}\n\n`
            : '';
          document.getElementById('tech-details-content').textContent = stepDetail + (data.output || '(no output captured)');
        })
        .catch(() => {
          document.getElementById('tech-details-content').textContent = 'Could not load technical details.';
        });
    }
  });
  document.getElementById('btn-run-again').addEventListener('click', onRunAgainClick);
}

function renderCancelledResult() {
  app.innerHTML = `
    <div class="result-banner cancel">
      <div class="title">⊘ TEST CANCELLED</div>
      <div class="stat">Stopped by user request.</div>
    </div>
    <div class="card">
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-run-again">Run Again</button>
        <button class="btn btn-secondary" id="btn-new">Start a new test</button>
      </div>
    </div>
  `;
  document.getElementById('btn-run-again').addEventListener('click', onRunAgainClick);
  document.getElementById('btn-new').addEventListener('click', () => {
    resetJobState();
    render();
  });
}

async function onRunAgainClick() {
  state.steps = [];
  state.activityLog = [];
  state.execResult = null;
  state.execStatus = 'running';
  state.execStartedAt = Date.now();
  state.cancelling = false;
  state.screen = 'executing';
  render();
  try {
    await api(`/api/jobs/${state.jobId}/rerun`, {
      method: 'POST',
      body: { environment: state.form.environment, browser: state.form.browser },
    });
  } catch (err) {
    state.errorMessage = err.message;
    state.screen = 'blocked';
    state.blockedMessage = err.message;
    render();
  }
}

// ---------------------------------------------------------------------------
// Tab: Applications
// ---------------------------------------------------------------------------

async function loadApplications() {
  state.applications = await api('/api/applications').catch(() => []);
  if (state.tab === 'applications') render();
}

function renderApplications() {
  app.innerHTML = `
    <div class="card">
      <h1>Applications</h1>
      <p class="subtitle">Every application GAP has discovered or generated tests for.</p>
      ${
        state.applications.length === 0
          ? '<div class="empty-state">No applications yet — generate your first test to see it here.</div>'
          : `<div class="app-grid">${state.applications
              .map(
                (a) => `
        <div class="app-tile">
          <h3>${esc(a.name || a.id)}</h3>
          <div class="stat-line">Last run: ${a.lastStatus ? `<span class="status-pill ${a.lastStatus}">${a.lastStatus}</span>` : '—'}</div>
          <div class="stat-line">Tests run: ${a.totalRuns}</div>
          <div class="stat-line">Pass rate: ${a.passRate}%</div>
          <button class="btn btn-secondary existing-tests-toggle" data-app="${esc(a.id)}">Existing Tests</button>
          <div class="app-tests" data-app-panel="${esc(a.id)}" hidden></div>
        </div>`,
              )
              .join('')}</div>`
      }
    </div>
  `;
  app.querySelectorAll('.existing-tests-toggle').forEach((btn) => {
    btn.addEventListener('click', () => toggleAppTests(btn.dataset.app));
  });
}

/**
 * Lists tests GAP already generated for an application and lets a Manual
 * QA re-run one immediately — no fresh generation/approval needed. Goes
 * through the exact same runExecutionJob/live-event path as
 * Approve & Run (server/ui/routes.ts's POST /api/tests/run), proving the
 * live execution view works for a test that already existed before this
 * page load, not only one just generated in this session.
 */
async function toggleAppTests(appId) {
  const panel = app.querySelector(`.app-tests[data-app-panel="${appId}"]`);
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = '<div class="stat-line">Loading…</div>';
  const tests = await api(`/api/applications/${appId}/tests`).catch(() => []);
  panel.innerHTML =
    tests.length === 0
      ? '<div class="stat-line">No generated tests yet.</div>'
      : tests
          .map(
            (t) => `
      <div class="existing-test-row">
        <span>${esc(t.name)}</span>
        <button class="btn btn-secondary btn-run-existing" data-app="${esc(appId)}" data-test="${esc(t.stableTestId)}" data-req="${esc(t.name)}">Run</button>
      </div>`,
          )
          .join('');
  panel.querySelectorAll('.btn-run-existing').forEach((btn) => {
    btn.addEventListener('click', () => runExistingTest(btn.dataset.app, btn.dataset.test, btn.dataset.req));
  });
}

async function runExistingTest(application, stableTestId, requirementText) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'home'));
  state.tab = 'home';
  resetJobState();
  state.outcome = { spec: { requirementText } };
  state.screen = 'executing';
  state.execStatus = 'running';
  state.execStartedAt = Date.now();
  startElapsedTimer();
  render();

  try {
    const { jobId } = await api('/api/tests/run', {
      method: 'POST',
      body: {
        application,
        stableTestId,
        requirementText,
        environment: state.form.environment,
        browser: state.form.browser,
      },
    });
    state.jobId = jobId;
    connectToJob(jobId);
  } catch (err) {
    stopElapsedTimer();
    state.errorMessage = err.message;
    state.screen = 'blocked';
    state.blockedMessage = err.message;
    render();
  }
}

// ---------------------------------------------------------------------------
// Tab: Test History
// ---------------------------------------------------------------------------

async function loadHistory() {
  state.history = await api('/api/history').catch(() => []);
  if (state.tab === 'history') render();
}

function renderHistory() {
  app.innerHTML = `
    <div class="card">
      <h1>Test History</h1>
      <p class="subtitle">Every test GAP has run through this UI.</p>
      ${
        state.history.length === 0
          ? '<div class="empty-state">No test runs yet.</div>'
          : `<table>
        <thead><tr><th>Date</th><th>Application</th><th>Requirement</th><th>Status</th><th>Duration</th><th>Test ID</th></tr></thead>
        <tbody>
          ${state.history
            .map(
              (h) => `<tr>
            <td>${new Date(h.timestamp).toLocaleString()}</td>
            <td>${esc(h.application)}</td>
            <td>${esc((h.requirementText || '').split('\n')[0])}</td>
            <td><span class="status-pill ${h.status}">${h.status}</span></td>
            <td>${(h.durationMs / 1000).toFixed(1)}s</td>
            <td>${esc(h.stableTestId || '—')}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>
  `;
}

render();
