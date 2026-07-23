// ── Global State ────────────────────────────────────────────
let councilData = null;
let expertResults = {};
let synthesisData = {};
let curatedOutputs = [];
let synthesisFull = null;
let filmBrief = null;
let expertRegistry = null;
let availableContexts = [];

let currentJobId = null;
let activeEvtSource = null;
let runningExperts = new Set();

let selectedOutputExpert = null;
let selectedPhase = null;
let activeOutputTab = 'summary';

let revisionVault = {};
let researchContextMode = 'basic'; // 'basic' | 'custom'
let customContextText = '';
let basicContextText = '';

let synthesisFeedback = null;
let synthesisGuardian = null;
let activeSynthesisTab = 'content'; // 'content' | 'feedback' | 'guardian'

let dragData = null; // {expertId, role, prompt_file, fromPhase}

// ── Helpers ─────────────────────────────────────────────────

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^## (.+)$/gm, '<h4>$1</h4>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function notify(msg, level = 'info') {
  const container = document.getElementById('notifications');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `notification notification-${level}`;
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 4000);
}

function getActiveContextText() {
  if (researchContextMode === 'custom' && customContextText.trim()) return customContextText;
  return '';
}

// ── Data Fetching ───────────────────────────────────────────

async function fetchCouncilData() {
  councilData = {};
  for (const stage of [1, 2]) {
    try {
      const res = await fetch(`/api/council/phases?stage=${stage}`);
      councilData[stage] = await res.json();
    } catch(e) {}
  }
}

async function fetchExpertResults() {
  expertResults = {};
  for (const stage of [1, 2]) {
    try {
      const res = await fetch(`/api/council/results?stage=${stage}`);
      const data = await res.json();
      for (const r of data.results) expertResults[r.expert_id] = r;
    } catch(e) {}
  }
  for (const eid of Object.keys(expertResults)) {
    try {
      const gRes = await fetch(`/api/council/expert/${eid}/context-guardian`);
      const gData = await gRes.json();
      if (gData.result) expertResults[eid]._guardian = gData.result;
    } catch(e) {}
    try {
      const fRes = await fetch(`/api/council/expert/${eid}/feedback-loop`);
      const fData = await fRes.json();
      if (fData.result) expertResults[eid]._feedbackResult = fData.result;
    } catch(e) {}
  }
}

async function fetchExpertRegistry() {
  const res = await fetch('/api/council/experts/registry');
  const data = await res.json();
  expertRegistry = data.experts;
}

async function fetchSynthesis() {
  for (const stage of [1, 2]) {
    try {
      const res = await fetch(`/api/council/synthesis?stage=${stage}`);
      const data = await res.json();
      if (data.synthesis) synthesisData[stage] = data.synthesis;
    } catch(e) {}
  }
}

async function fetchCuratedOutputs() {
  try {
    const res = await fetch('/api/curated');
    curatedOutputs = (await res.json()).outputs || [];
  } catch(e) { curatedOutputs = []; }
}

async function fetchFilmBrief() {
  try {
    const res = await fetch('/api/film-brief?stage=2');
    filmBrief = (await res.json()).brief;
  } catch(e) {}
}

async function fetchAvailableContexts() {
  try {
    const res = await fetch('/api/council/contexts');
    const data = await res.json();
    availableContexts = data.contexts || [];
    const basic = availableContexts.find(c => c.id === 'basic');
    if (basic) {
      basicContextText = basic.content || '';
    }
  } catch(e) { availableContexts = []; }
}

async function fetchSynthesisFeedback() {
  try {
    const res = await fetch('/api/synthesis/feedback-loop');
    const data = await res.json();
    synthesisFeedback = data.result || null;
  } catch(e) { synthesisFeedback = null; }
}

async function fetchSynthesisGuardian() {
  try {
    const res = await fetch('/api/synthesis/context-guardian');
    const data = await res.json();
    synthesisGuardian = data.result || null;
  } catch(e) { synthesisGuardian = null; }
}

async function fetchActiveJobs() {
  try {
    const res = await fetch('/api/jobs/active');
    const data = await res.json();
    if (data.jobs?.length > 0) {
      const job = data.jobs[0];
      currentJobId = job.job_id;
      runningExperts.clear();
      for (const eid of (job.running_experts || [])) runningExperts.add(eid);
      connectSSE(currentJobId);
      render();
    }
  } catch(e) {}
}

// Poll for active jobs periodically so we recover from SSE drops
setInterval(async () => {
  if (currentJobId) return;
  try {
    const res = await fetch('/api/jobs/active');
    const data = await res.json();
    if (data.jobs?.length > 0) {
      const job = data.jobs[0];
      currentJobId = job.job_id;
      runningExperts.clear();
      for (const eid of (job.running_experts || [])) runningExperts.add(eid);
      connectSSE(currentJobId);
      render();
    }
  } catch(e) {}
}, 5000);

// ── Init ────────────────────────────────────────────────────

async function init() {
  await Promise.all([
    fetchCouncilData(), fetchExpertResults(), fetchExpertRegistry(),
    fetchSynthesis(), fetchCuratedOutputs(), fetchFilmBrief(), fetchAvailableContexts(),
    fetchSynthesisFeedback(), fetchSynthesisGuardian(),
  ]);
  await fetchActiveJobs();
  render();
}

// ── Main Render ─────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="workspace">
      <div class="workspace-col">${renderResearchColumn()}</div>
      <div class="workspace-col">${renderOutputsColumn()}</div>
      <div class="workspace-col">${renderSynthesisColumn()}</div>
    </div>
  `;
}

// ── LEFT COLUMN: Research ───────────────────────────────────

function getAllPhases() {
  const phases = [];
  const order = ['research', 'narrative', 'worldbuilding', 'treatment'];
  for (const stage of [1, 2]) {
    const cd = councilData[stage];
    if (!cd?.phases) continue;
    for (const p of cd.phases) phases.push({ ...p, stage });
  }
  phases.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return phases;
}

function getAllExperts() {
  const experts = [];
  for (const p of getAllPhases()) {
    for (const e of p.experts) {
      if (!experts.find(x => x.id === e.id))
        experts.push({ ...e, phase_id: p.id, stage: p.stage });
    }
    for (const g of (p.guardians || [])) {
      if (!experts.find(x => x.id === g.id))
        experts.push({ ...g, phase_id: p.id, stage: p.stage, isGuardian: true });
    }
  }
  return experts;
}

function renderResearchColumn() {
  const phases = getAllPhases();
  const allExperts = getAllExperts();
  const doneCount = allExperts.filter(e => expertResults[e.id]).length;

  let html = `
    <div class="col-header">
      <h3>Research <span class="col-count">${doneCount}/${allExperts.length}</span></h3>
      <div style="display:flex;gap:0.25rem">
        ${currentJobId
          ? `<button class="btn btn-sm btn-danger-outline" onclick="stopGeneration()">Stop</button>`
          : `<button class="btn btn-sm btn-primary" onclick="runAllPhases()">Run All</button>`}
        <button class="btn btn-sm btn-ghost" onclick="openResetModal()">Reset</button>
      </div>
    </div>
    <div class="col-body">
  `;

  // Context prompt window
  html += renderContextPrompt();

  // Phases
  for (const phase of phases) {
    const isExpanded = selectedPhase === phase.id;
    const allPhaseMembers = [...phase.experts, ...(phase.guardians || [])];
    const phaseDone = allPhaseMembers.filter(e => expertResults[e.id]).length;
    const phaseRunning = allPhaseMembers.some(e => runningExperts.has(e.id));
    const dotClass = phaseDone === allPhaseMembers.length && phaseDone > 0 ? 'done' : phaseRunning ? 'running' : phaseDone > 0 ? 'active' : '';

    html += `<div class="phase-block" data-phase-id="${phase.id}" data-phase-stage="${phase.stage}">
      <div class="phase-block-header" onclick="togglePhase('${phase.id}')">
        <div class="phase-block-title">
          <div class="phase-dot ${dotClass}"></div>
          ${escapeHtml(phase.name)}
          <span class="col-count">${phaseDone}/${allPhaseMembers.length}</span>
        </div>
        <span style="font-size:0.6rem;color:var(--text-muted)">${phase.stage === 1 ? 'S1' : 'S2'}</span>
      </div>`;

    if (isExpanded) {
      const guardians = phase.guardians || [];
      const assignedExpertIds = new Set(phase.experts.map(e => e.id));
      const assignedGuardianIds = new Set(guardians.map(g => g.id));
      const availableExperts = (expertRegistry || []).filter(e => !e.is_guardian && !assignedExpertIds.has(e.id));
      const availableGuardians = (expertRegistry || []).filter(e => e.is_guardian && !assignedGuardianIds.has(e.id));

      html += `<div class="phase-block-body">
        <div class="phase-slot-section">
          <div class="phase-slot-header">
            <span class="phase-slot-label">Experts</span>
            <select class="phase-add-select" onchange="addFromDropdown(this, '${phase.id}', ${phase.stage}, 'experts')">
              <option value="">+ Add expert...</option>
              ${availableExperts.map(e => `<option value="${e.id}" data-role="${escapeAttr(e.role)}" data-pf="${escapeAttr(e.prompt_file)}">${escapeHtml(e.role)}</option>`).join('')}
            </select>
          </div>
          <div class="expert-chip-list">
            ${phase.experts.map(e => {
              const done = !!expertResults[e.id];
              const running = runningExperts.has(e.id);
              const cls = running ? 'running' : done ? 'has-result' : '';
              return `<span class="expert-chip ${cls}" onclick="selectExpertOutput('${e.id}')">
                ${escapeHtml(e.role)}
                <button class="expert-chip-remove" onclick="event.stopPropagation(); removeExpertFromPhase('${phase.id}', '${e.id}', ${phase.stage}, 'experts')">&times;</button>
              </span>`;
            }).join('')}
          </div>
        </div>
        <div class="phase-slot-section guardian-section">
          <div class="phase-slot-header">
            <span class="phase-slot-label guardian-label">Guardians</span>
            <select class="phase-add-select guardian-select" onchange="addFromDropdown(this, '${phase.id}', ${phase.stage}, 'guardians')">
              <option value="">+ Add guardian...</option>
              ${availableGuardians.map(e => `<option value="${e.id}" data-role="${escapeAttr(e.role)}" data-pf="${escapeAttr(e.prompt_file)}">${escapeHtml(e.role)}</option>`).join('')}
            </select>
          </div>
          <div class="guardian-chip-list">
            ${guardians.map(g => {
              const done = !!expertResults[g.id];
              const running = runningExperts.has(g.id);
              const cls = running ? 'running' : done ? 'has-result' : '';
              return `<span class="expert-chip guardian-chip ${cls}" onclick="selectExpertOutput('${g.id}')">
                ${escapeHtml(g.role)}
                <button class="expert-chip-remove" onclick="event.stopPropagation(); removeExpertFromPhase('${phase.id}', '${g.id}', ${phase.stage}, 'guardians')">&times;</button>
              </span>`;
            }).join('')}
          </div>
        </div>
        <div class="phase-actions">
          <button class="btn btn-sm btn-primary" onclick="runPhase('${phase.id}', ${phase.stage})" ${currentJobId ? 'disabled' : ''}>${phaseDone > 0 ? 'Re-run' : 'Run Phase'}</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  html += '</div>';
  // Expert Library outside col-body, fills remaining space
  html += renderExpertLibrary();
  return html;
}

function renderContextPrompt() {
  return `<details class="context-prompt-box">
    <summary class="context-prompt-header">
      <span class="context-prompt-label">Research Context</span>
      <div class="context-prompt-toggle" onclick="event.stopPropagation()">
        <button class="btn btn-xs ${researchContextMode === 'basic' ? 'btn-primary' : 'btn-ghost'}" onclick="setContextMode('basic')">Basic</button>
        <button class="btn btn-xs ${researchContextMode === 'custom' ? 'btn-primary' : 'btn-ghost'}" onclick="setContextMode('custom')">Custom</button>
      </div>
    </summary>
    <div class="context-prompt-content">
    ${researchContextMode === 'custom'
      ? `<textarea class="context-prompt-textarea" rows="6"
          placeholder="Enter custom context for all experts..."
          oninput="customContextText = this.value">${escapeHtml(customContextText)}</textarea>`
      : `<div class="context-prompt-preview">${escapeHtml(basicContextText)}</div>`
    }
    </div>
  </details>`;
}

function setContextMode(mode) {
  researchContextMode = mode;
  render();
}

function renderExpertLibrary() {
  if (!expertRegistry?.length) return '';

  const assignedIds = new Set(getAllExperts().map(e => e.id));

  let html = `<div class="expert-pool">
    <div class="expert-pool-header">
      <span>Expert Library (${expertRegistry.length})</span>
      <button class="btn btn-xs btn-ghost" onclick="openCreateExpertModal()">+ New</button>
    </div>
    <ul class="expert-bullet-list expert-pool-list">`;

  for (const e of expertRegistry) {
    const assigned = assignedIds.has(e.id);
    const hasResult = !!expertResults[e.id];
    const isGuardian = !!e.is_guardian;
    const defaultSlot = isGuardian ? 'guardians' : 'experts';
    html += `<li class="expert-bullet ${assigned ? 'assigned' : ''} ${isGuardian ? 'guardian-bullet' : ''}"
      draggable="true"
      ondragstart="onExpertDragStart(event, '${e.id}', '${escapeAttr(e.role)}', '${escapeAttr(e.prompt_file)}', '', 0, '${defaultSlot}')"
      onclick="openExpertPromptModal('${e.id}')">
      <div class="expert-bullet-header">
        <span class="drag-handle">&#x2807;</span>
        <strong>${escapeHtml(e.role)}</strong>
        ${isGuardian ? '<span style="font-size:0.5rem;color:var(--warning);margin-left:2px">G</span>' : ''}
        ${assigned ? '<span style="font-size:0.55rem;color:var(--accent)">&#x25CF;</span>' : ''}
        ${hasResult ? '<span style="font-size:0.55rem;color:var(--success)">&#x2713;</span>' : ''}
      </div>
      ${e.description ? `<span class="expert-bullet-desc">${escapeHtml(e.description)}</span>` : ''}
    </li>`;
  }

  html += `</ul></div>`;
  return html;
}

// ── Drag & Drop ─────────────────────────────────────────────

function onExpertDragStart(event, expertId, role, promptFile, fromPhase, fromStage, fromSlot) {
  dragData = { expertId, role, prompt_file: promptFile, fromPhase, fromStage, fromSlot: fromSlot || 'experts' };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', expertId);
}

function onPhaseDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('phase-drop-target');
}

document.addEventListener('dragleave', (e) => {
  const zone = e.target.closest?.('.expert-chip-list, .guardian-slot');
  if (zone) zone.classList.remove('phase-drop-target');
});

async function onPhaseDrop(event, phaseId, stage, slot) {
  event.preventDefault();
  event.currentTarget.classList.remove('phase-drop-target');
  if (!dragData) return;

  const { expertId, role, prompt_file, fromPhase, fromStage, fromSlot } = dragData;
  const targetSlot = slot || 'experts';

  // Remove from old location
  if (fromPhase) {
    const oldSlot = fromSlot || 'experts';
    await fetch(`/api/council/phase/${fromPhase}/${oldSlot}/${expertId}?stage=${fromStage}`, { method: 'DELETE' });
  }

  // Add to new location (unless dropping back to same spot)
  if (fromPhase !== phaseId || fromSlot !== targetSlot) {
    const res = await fetch(`/api/council/phase/${phaseId}/${targetSlot}?stage=${stage}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expert_id: expertId, role, prompt_file }),
    });
    const data = await res.json();
    if (data.error && data.error !== 'Already assigned') {
      notify(data.error, 'error');
    }
  }

  dragData = null;
  await fetchCouncilData();
  render();
}

async function addFromDropdown(selectEl, phaseId, stage, slot) {
  const expertId = selectEl.value;
  if (!expertId) return;
  const opt = selectEl.selectedOptions[0];
  const role = opt?.dataset?.role || '';
  const prompt_file = opt?.dataset?.pf || '';
  const res = await fetch(`/api/council/phase/${phaseId}/${slot}?stage=${stage}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expert_id: expertId, role, prompt_file }),
  });
  const data = await res.json();
  if (data.error && data.error !== 'Already assigned') {
    notify(data.error, 'error');
  }
  await fetchCouncilData();
  render();
}

async function removeExpertFromPhase(phaseId, expertId, stage, slot) {
  const s = slot || 'experts';
  await fetch(`/api/council/phase/${phaseId}/${s}/${expertId}?stage=${stage}`, { method: 'DELETE' });
  await fetchCouncilData();
  render();
}

// ── MIDDLE COLUMN: Outputs & Refinement ─────────────────────

function getExpertsWithResults() {
  return getAllExperts().filter(e => expertResults[e.id]);
}

function renderOutputsColumn() {
  const expertsWithResults = getExpertsWithResults();
  if (!selectedOutputExpert && expertsWithResults.length > 0) {
    selectedOutputExpert = expertsWithResults[0].id;
  }

  let html = `<div class="col-header">
    <h3>Outputs <span class="col-count">${expertsWithResults.length} results</span></h3>
    <div style="display:flex;gap:0.25rem">
      ${selectedOutputExpert && expertResults[selectedOutputExpert]
        ? `<button class="btn btn-sm btn-success" onclick="curateOutput('${selectedOutputExpert}')">Send to Synthesis &rarr;</button>`
        : ''}
    </div>
  </div>`;

  if (expertsWithResults.length === 0) {
    html += `<div class="col-body"><div class="empty-state"><div class="empty-icon">&#x1F4CB;</div><p>Run experts in the Research column. Outputs appear here for review and refinement.</p></div></div>`;
    return html;
  }

  html += `<div class="output-tabs">`;
  for (const e of expertsWithResults) {
    const isActive = selectedOutputExpert === e.id;
    const result = expertResults[e.id];
    const revised = result?.revision_count > 0;
    html += `<button class="output-tab has-result ${isActive ? 'active' : ''}" onclick="selectExpertOutput('${e.id}')">
      ${escapeHtml(e.role)}${revised ? ` (v${result.revision_count + 1})` : ''}
    </button>`;
  }
  html += `</div>`;

  if (selectedOutputExpert && expertResults[selectedOutputExpert]) {
    const result = expertResults[selectedOutputExpert];
    const hasGuardian = !!result._guardian;
    const hasFeedback = !!result._feedbackResult;

    html += `<div class="output-tabs" style="border-bottom:1px solid var(--border);background:var(--surface)">
      <button class="output-tab ${activeOutputTab === 'summary' ? 'active' : ''}" onclick="setOutputTab('summary')">Summary</button>
      <button class="output-tab ${activeOutputTab === 'full' ? 'active' : ''}" onclick="setOutputTab('full')">Full Output</button>
      <button class="output-tab ${activeOutputTab === 'feedback' ? 'active' : ''} ${hasFeedback ? 'has-result' : ''}" onclick="setOutputTab('feedback')">Feedback Loop${hasFeedback ? ' &#x2713;' : ''}</button>
      <button class="output-tab ${activeOutputTab === 'guardian' ? 'active' : ''} ${hasGuardian ? 'has-result' : ''}" onclick="setOutputTab('guardian')">Guardian${hasGuardian ? ' &#x2713;' : ''}</button>
    </div>`;

    html += `<div class="col-body">`;

    const vault = revisionVault[selectedOutputExpert] || [];
    if (vault.length > 0) html += renderRevisionVault(selectedOutputExpert, vault);

    if (activeOutputTab === 'summary') html += renderSummaryTab(result);
    else if (activeOutputTab === 'full') html += renderFullTab(result);
    else if (activeOutputTab === 'feedback') html += renderFeedbackTab(selectedOutputExpert, result);
    else if (activeOutputTab === 'guardian') html += renderGuardianTab(selectedOutputExpert, result);

    html += `</div>`;
  }

  return html;
}

function renderSummaryTab(result) {
  let html = '';
  if (result.summary) {
    html += `<div class="output-summary">${renderMarkdown(result.summary)}</div>`;
  } else {
    html += `<div class="empty-state" style="padding:1.5rem"><p>Summary is being generated...</p></div>`;
  }
  if (result.revision_count > 0) {
    html += `<div style="margin-top:0.5rem;font-size:0.7rem;color:var(--text-muted)">Revision ${result.revision_count} &mdash; revised at ${result.revised_at?.split('T')[0] || 'unknown'}</div>`;
  }
  return html;
}

function renderFullTab(result) {
  return `<div class="output-full">${renderMarkdown(result.content)}</div>`;
}

function renderFeedbackTab(expertId, result) {
  let html = '';
  const fl = result._feedbackResult;

  if (!fl) {
    html += `<div style="padding:0.75rem">
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem">Run a multi-model feedback loop &mdash; 6 AI models debate and refine the output through blind peer review.</p>
      <button class="btn btn-primary" onclick="runFeedbackLoop('${expertId}')">Run Feedback Loop</button>
    </div>`;
    return html;
  }

  if (fl.analysis) {
    html += `<div style="padding:0.5rem">`;
    if (fl.analysis.summary) {
      html += `<div class="output-summary"><strong>Summary:</strong> ${escapeHtml(fl.analysis.summary)}</div>`;
    }
    const sections = [
      { key: 'consensus_points', title: 'Consensus Points', color: 'var(--success)', prefix: 'fl_consensus' },
      { key: 'strongest_ideas', title: 'Strongest Ideas', color: 'var(--accent)', prefix: 'fl_idea' },
      { key: 'similarities', title: 'Similarities', color: 'var(--text)', prefix: 'fl_sim', format: s => `${s.theme}: ${s.detail}` },
      { key: 'differences', title: 'Differences & Tensions', color: 'var(--warning)', prefix: 'fl_diff', format: d => `${d.theme}: ${d.detail}` },
    ];
    for (const sec of sections) {
      const items = fl.analysis[sec.key];
      if (items?.length) {
        html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${sec.color}">${sec.title}</h5>`;
        items.forEach((item, i) => {
          const itemId = `${sec.prefix}_${i}`;
          const text = sec.format ? sec.format(item) : item;
          const inVault = (revisionVault[expertId] || []).find(v => v.id === itemId);
          html += renderFeedbackCard(expertId, itemId, text, `Feedback Loop &mdash; ${sec.title}`, inVault);
        });
        html += `</div>`;
      }
    }
    html += `</div>`;
  }

  const lastRound = fl.rounds?.[fl.rounds.length - 1];
  if (lastRound?.statements) {
    html += `<details style="padding:0.5rem"><summary style="font-size:0.75rem;cursor:pointer;color:var(--text-muted)">Final Model Statements (${Object.keys(lastRound.statements).length})</summary>`;
    for (const [mid, stmt] of Object.entries(lastRound.statements)) {
      html += `<div class="fl-statement-card">
        <div class="fl-statement-model">${escapeHtml(stmt.name)}</div>
        <div class="fl-statement-text">${renderMarkdown(stmt.text)}</div>
      </div>`;
    }
    html += `</details>`;
  }

  html += `<div style="padding:0.5rem"><button class="btn btn-sm" onclick="runFeedbackLoop('${expertId}')">Re-run Feedback Loop</button></div>`;
  return html;
}

function renderGuardianTab(expertId, result) {
  let html = '';
  const guardian = result._guardian;

  html += `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
      <span style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:600">Check against:</span>
      ${availableContexts.map(ctx => `
        <label style="display:flex;align-items:center;gap:0.25rem;font-size:0.72rem;cursor:pointer">
          <input type="checkbox" class="guardian-ctx-check" value="${escapeAttr(ctx.id)}"
            ${['disordine','futurax'].includes(ctx.id) ? 'checked' : ''} style="accent-color:var(--accent)">
          ${escapeHtml(ctx.name)}
        </label>
      `).join('')}
    </div>
    <details>
      <summary style="font-size:0.7rem;color:var(--text-muted);cursor:pointer">Add custom context</summary>
      <textarea id="guardian-custom-ctx" rows="3" placeholder="Paste or type custom context here..."
        style="width:100%;margin-top:0.35rem;padding:0.4rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.75rem;font-family:inherit;resize:vertical"></textarea>
    </details>
    <button class="btn btn-sm btn-primary" onclick="runContextGuardian('${expertId}')" style="margin-top:0.5rem">
      ${guardian ? 'Re-run' : 'Run'} Context Guardian
    </button>
  </div>`;

  if (!guardian) {
    html += `<div class="col-body" style="padding:0.75rem"><div class="empty-state"><p>Select contexts above and run the guardian to check alignment.</p></div></div>`;
    return html;
  }

  if (guardian.sections) {
    for (const section of guardian.sections) {
      html += `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
          <h5 style="font-size:0.8rem;color:var(--accent)">${escapeHtml(section.context_name)}</h5>
          <span style="font-size:1.2rem;font-weight:700;${section.score >= 7 ? 'color:var(--success)' : section.score >= 4 ? 'color:var(--warning)' : 'color:var(--danger)'}">${section.score}/10</span>
        </div>`;

      if (section.error) {
        html += `<div style="color:var(--danger);font-size:0.75rem">Error: ${escapeHtml(section.error)}</div>`;
      } else {
        const categories = [
          { key: 'strengths', title: 'Strengths', color: 'var(--success)' },
          { key: 'concerns', title: 'Concerns', color: 'var(--danger)' },
          { key: 'suggestions', title: 'Suggestions', color: 'var(--info)' },
          { key: 'missing_elements', title: 'Missing Elements', color: 'var(--warning)' },
        ];
        for (const cat of categories) {
          if (section[cat.key]?.length) {
            html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${cat.color}">${cat.title}</h5>`;
            section[cat.key].forEach(item => {
              const inVault = (revisionVault[expertId] || []).find(v => v.id === item.id);
              html += renderFeedbackCard(expertId, item.id, item.text, `Guardian &mdash; ${section.context_name} &mdash; ${cat.title.slice(0, -1)}`, inVault);
            });
            html += `</div>`;
          }
        }
      }
      html += `</div>`;
    }
  }

  return html;
}

function renderFeedbackCard(expertId, itemId, text, source, inVault) {
  return `<div class="feedback-card ${inVault ? 'in-vault' : ''}" data-item-id="${itemId}">
    <div class="feedback-card-text">${escapeHtml(text)}</div>
    <button class="btn btn-xs ${inVault ? 'btn-danger-outline' : 'btn-ghost'}"
      onclick="toggleVaultItem('${expertId}', '${itemId}', ${JSON.stringify(escapeAttr(text))}, ${JSON.stringify(escapeAttr(source))})">
      ${inVault ? '&minus; Remove' : '+ Vault'}
    </button>
  </div>`;
}

// ── Revision Vault ──────────────────────────────────────────

function renderRevisionVault(expertId, vault) {
  return `<div class="revision-vault">
    <div class="revision-vault-header">
      <h5>Revision Vault (${vault.length})</h5>
      <div style="display:flex;gap:0.25rem">
        <button class="btn btn-xs btn-primary" onclick="sendForRevision('${expertId}')">Send for Revision</button>
        <button class="btn btn-xs btn-ghost" onclick="clearVault('${expertId}')">Clear</button>
      </div>
    </div>
    <div class="revision-vault-items">
      ${vault.map(item => `
        <div class="vault-item">
          <div class="vault-item-source">${escapeHtml(item.source)}</div>
          <div class="vault-item-text">${escapeHtml(item.text)}</div>
          <button class="btn-icon" onclick="removeVaultItem('${expertId}', '${item.id}')" title="Remove">&times;</button>
        </div>
      `).join('')}
    </div>
  </div>`;
}

function toggleVaultItem(expertId, itemId, text, source) {
  if (!revisionVault[expertId]) revisionVault[expertId] = [];
  const idx = revisionVault[expertId].findIndex(v => v.id === itemId);
  if (idx >= 0) revisionVault[expertId].splice(idx, 1);
  else revisionVault[expertId].push({ id: itemId, text, source });
  render();
}

function removeVaultItem(expertId, itemId) {
  if (!revisionVault[expertId]) return;
  revisionVault[expertId] = revisionVault[expertId].filter(v => v.id !== itemId);
  render();
}

function clearVault(expertId) { revisionVault[expertId] = []; render(); }

async function sendForRevision(expertId) {
  const vault = revisionVault[expertId] || [];
  if (vault.length === 0) { notify('Vault is empty', 'error'); return; }
  notify(`Sending ${vault.length} feedback items for revision...`, 'phase');
  try {
    const res = await fetch(`/api/council/expert/${expertId}/revise`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback_items: vault }),
    });
    const data = await res.json();
    if (data.ok) {
      expertResults[expertId].content = data.content;
      expertResults[expertId].revision_count = data.revision_count;
      expertResults[expertId].revised_at = new Date().toISOString();
      delete expertResults[expertId].summary;
      revisionVault[expertId] = [];
      notify(`Output revised (v${data.revision_count + 1})`, 'done');
      try { const r = await fetch(`/api/council/results/${expertId}`); expertResults[expertId] = await r.json(); } catch(e) {}
      render();
    } else notify(`Revision failed: ${data.error}`, 'error');
  } catch(e) { notify('Revision failed', 'error'); }
}

// ── RIGHT COLUMN: Synthesis ─────────────────────────────────

function renderSynthesisColumn() {
  let html = `
    <div class="col-header">
      <h3>Synthesis <span class="col-count">${curatedOutputs.length} curated</span></h3>
      <div style="display:flex;gap:0.25rem">
        ${curatedOutputs.length > 0 ? `<button class="btn btn-sm btn-primary" onclick="runSynthesis()">Synthesize</button>` : ''}
        ${synthesisFull ? `<button class="btn btn-sm" onclick="extractFilmBrief()">Film Brief</button>` : ''}
      </div>
    </div>
    <div class="col-body">
  `;

  if (curatedOutputs.length === 0 && !synthesisFull && !filmBrief) {
    html += `<div class="empty-state"><div class="empty-icon">&#x1F3AC;</div><p>Refine expert outputs, then send them here. Synthesize into a unified vision when ready.</p></div>`;
    html += '</div>';
    return html;
  }

  if (filmBrief) {
    html += `<div style="margin-bottom:0.75rem">
      <button class="btn btn-sm btn-success" onclick="openFilmBriefModal()" style="width:100%">
        View Film Brief ${filmBrief.characters ? `(${filmBrief.characters.length} chars, ${filmBrief.environments?.length || 0} envs, ${filmBrief.scenes?.length || 0} scenes)` : ''}
      </button>
    </div>`;
  }

  if (synthesisFull) {
    html += `<div class="synthesis-output">
      <div class="output-tabs" style="margin-bottom:0.5rem">
        <button class="tab-btn ${activeSynthesisTab === 'content' ? 'active' : ''}" onclick="setSynthesisTab('content')">Content</button>
        <button class="tab-btn ${activeSynthesisTab === 'feedback' ? 'active' : ''}" onclick="setSynthesisTab('feedback')">Feedback Loop${synthesisFeedback ? ' ✓' : ''}</button>
        <button class="tab-btn ${activeSynthesisTab === 'guardian' ? 'active' : ''}" onclick="setSynthesisTab('guardian')">Guardian${synthesisGuardian ? ' ✓' : ''}</button>
      </div>
      ${activeSynthesisTab === 'content' ? `<div class="synthesis-content" style="overflow-y:auto">${renderMarkdown(synthesisFull)}</div>` : ''}
      ${activeSynthesisTab === 'feedback' ? renderSynthesisFeedbackTab() : ''}
      ${activeSynthesisTab === 'guardian' ? renderSynthesisGuardianTab() : ''}
    </div>`;
  }

  if (curatedOutputs.length > 0) {
    html += `<div style="margin-top:0.75rem"><h4 style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.5rem">Curated Outputs</h4>`;
    for (const item of curatedOutputs) {
      html += `<div class="curated-item">
        <div class="curated-item-header">
          <span class="curated-item-role">${escapeHtml(item.role)}</span>
          <span class="curated-item-source">${escapeHtml(item.phase_id || '')}</span>
        </div>
        <div class="curated-item-preview">${escapeHtml(item.content?.substring(0, 200) || '')}...</div>
        <div class="curated-item-actions">
          <button class="btn btn-xs btn-ghost" onclick="selectExpertOutput('${item.expert_id}')">View</button>
          <button class="btn btn-xs btn-danger-outline" onclick="removeCuratedItem('${item.expert_id}')">Remove</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function setSynthesisTab(tab) { activeSynthesisTab = tab; render(); }

function renderSynthesisFeedbackTab() {
  if (!synthesisFeedback) {
    return `<div style="padding:0.75rem">
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem">Run a multi-model feedback loop on the synthesis &mdash; 6 AI models debate and refine the output.</p>
      <button class="btn btn-primary" onclick="runSynthesisFeedbackLoop()">Run Feedback Loop</button>
    </div>`;
  }

  let html = '';
  const fl = synthesisFeedback;
  if (fl.analysis) {
    html += `<div style="padding:0.5rem">`;
    if (fl.analysis.summary) {
      html += `<div class="output-summary"><strong>Summary:</strong> ${escapeHtml(fl.analysis.summary)}</div>`;
    }
    const sections = [
      { key: 'consensus_points', title: 'Consensus Points', color: 'var(--success)' },
      { key: 'strongest_ideas', title: 'Strongest Ideas', color: 'var(--accent)' },
      { key: 'similarities', title: 'Similarities', color: 'var(--text)', format: s => `${s.theme}: ${s.detail}` },
      { key: 'differences', title: 'Differences & Tensions', color: 'var(--warning)', format: d => `${d.theme}: ${d.detail}` },
    ];
    for (const sec of sections) {
      const items = fl.analysis[sec.key];
      if (items?.length) {
        html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${sec.color}">${sec.title}</h5>`;
        items.forEach(item => {
          const text = sec.format ? sec.format(item) : item;
          html += `<div class="feedback-card"><div class="feedback-card-text">${escapeHtml(text)}</div></div>`;
        });
        html += `</div>`;
      }
    }
    html += `</div>`;
  }

  const lastRound = fl.rounds?.[fl.rounds.length - 1];
  if (lastRound?.statements) {
    html += `<details style="padding:0.5rem"><summary style="font-size:0.75rem;cursor:pointer;color:var(--text-muted)">Final Model Statements (${Object.keys(lastRound.statements).length})</summary>`;
    for (const [mid, stmt] of Object.entries(lastRound.statements)) {
      html += `<div class="fl-statement-card">
        <div class="fl-statement-model">${escapeHtml(stmt.name)}</div>
        <div class="fl-statement-text">${renderMarkdown(stmt.text)}</div>
      </div>`;
    }
    html += `</details>`;
  }

  html += `<div style="padding:0.5rem"><button class="btn btn-sm" onclick="runSynthesisFeedbackLoop()">Re-run Feedback Loop</button></div>`;
  return html;
}

function renderSynthesisGuardianTab() {
  let html = `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
      <span style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:600">Check against:</span>
      ${availableContexts.map(ctx => `
        <label style="display:flex;align-items:center;gap:0.25rem;font-size:0.72rem;cursor:pointer">
          <input type="checkbox" class="synth-guardian-ctx-check" value="${escapeAttr(ctx.id)}"
            ${['disordine','futurax'].includes(ctx.id) ? 'checked' : ''} style="accent-color:var(--accent)">
          ${escapeHtml(ctx.name)}
        </label>
      `).join('')}
    </div>
    <details>
      <summary style="font-size:0.7rem;color:var(--text-muted);cursor:pointer">Add custom context</summary>
      <textarea id="synth-guardian-custom-ctx" rows="3" placeholder="Paste or type custom context here..."
        style="width:100%;margin-top:0.35rem;padding:0.4rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.75rem;font-family:inherit;resize:vertical"></textarea>
    </details>
    <button class="btn btn-sm btn-primary" onclick="runSynthesisGuardian()" style="margin-top:0.5rem">
      ${synthesisGuardian ? 'Re-run' : 'Run'} Context Guardian
    </button>
  </div>`;

  if (!synthesisGuardian) {
    html += `<div style="padding:0.75rem"><div class="empty-state"><p>Select contexts above and run the guardian to check synthesis alignment.</p></div></div>`;
    return html;
  }

  if (synthesisGuardian.sections) {
    for (const section of synthesisGuardian.sections) {
      html += `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
          <h5 style="font-size:0.8rem;color:var(--accent)">${escapeHtml(section.context_name)}</h5>
          <span style="font-size:1.2rem;font-weight:700;${section.score >= 7 ? 'color:var(--success)' : section.score >= 4 ? 'color:var(--warning)' : 'color:var(--danger)'}">${section.score}/10</span>
        </div>`;
      if (section.error) {
        html += `<div style="color:var(--danger);font-size:0.75rem">Error: ${escapeHtml(section.error)}</div>`;
      } else {
        const categories = [
          { key: 'strengths', title: 'Strengths', color: 'var(--success)' },
          { key: 'concerns', title: 'Concerns', color: 'var(--danger)' },
          { key: 'suggestions', title: 'Suggestions', color: 'var(--info)' },
          { key: 'missing_elements', title: 'Missing Elements', color: 'var(--warning)' },
        ];
        for (const cat of categories) {
          if (section[cat.key]?.length) {
            html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${cat.color}">${cat.title}</h5>`;
            section[cat.key].forEach(item => {
              html += `<div class="feedback-card"><div class="feedback-card-text">${escapeHtml(item.text)}</div></div>`;
            });
            html += `</div>`;
          }
        }
      }
      html += `</div>`;
    }
  }
  return html;
}

// ── Actions ─────────────────────────────────────────────────

function togglePhase(phaseId) {
  selectedPhase = selectedPhase === phaseId ? null : phaseId;
  render();
}

function selectExpertOutput(expertId) {
  selectedOutputExpert = expertId;
  activeOutputTab = 'summary';
  render();
}

function setOutputTab(tab) { activeOutputTab = tab; render(); }

// ── Run Experts ─────────────────────────────────────────────

async function runPhase(phaseId, stage) {
  const ctxText = getActiveContextText();
  const res = await fetch('/api/council/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase_id: phaseId, stage, run_mode: 'phase', context_text: ctxText }),
  });
  const data = await res.json();
  if (data.ok) { currentJobId = data.job_id; connectSSE(data.job_id); render(); }
}

async function runAllPhases() {
  const ctxText = getActiveContextText();
  const phases = getAllPhases();
  if (!phases.length) return;
  const first = phases[0];
  const res = await fetch('/api/council/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase_id: first.id, stage: first.stage, run_mode: 'phase', context_text: ctxText }),
  });
  const data = await res.json();
  if (data.ok) { currentJobId = data.job_id; connectSSE(data.job_id); render(); }
}

async function stopGeneration() {
  if (!currentJobId) return;
  await fetch(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
  currentJobId = null;
  runningExperts.clear();
  if (activeEvtSource) { activeEvtSource.close(); activeEvtSource = null; }
  render();
}

function connectSSE(jobId) {
  if (activeEvtSource) activeEvtSource.close();
  activeEvtSource = new EventSource(`/api/jobs/${jobId}/stream`);

  activeEvtSource.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'log') {
      if (data.level === 'start' && data.expert) { runningExperts.add(data.expert); render(); }
      if (data.level === 'done' && data.expert) {
        runningExperts.delete(data.expert);
        try { const r = await fetch(`/api/council/results/${data.expert}`); expertResults[data.expert] = await r.json(); } catch(e) {}
        render();
      }
      if (['phase','done','error'].includes(data.level)) {
        notify(data.message, data.level === 'error' ? 'error' : data.level === 'phase' ? 'phase' : 'done');
      }
    }
    if (data.type === 'done') {
      currentJobId = null; runningExperts.clear();
      if (activeEvtSource) { activeEvtSource.close(); activeEvtSource = null; }
      await fetchExpertResults();
      render();
    }
  };

  activeEvtSource.onerror = () => {
    if (activeEvtSource) { activeEvtSource.close(); activeEvtSource = null; }
    // Don't clear job state — the server task is still running.
    // The 5s poll will reconnect if the job is still active.
    runningExperts.clear();
    currentJobId = null;
    render();
  };
}

// ── Feedback Loop ───────────────────────────────────────────

async function runFeedbackLoop(expertId) {
  notify(`Starting feedback loop for ${expertResults[expertId]?.role || expertId}...`, 'phase');
  const res = await fetch(`/api/council/expert/${expertId}/feedback-loop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_rounds: 3 }),
  });
  const data = await res.json();
  if (!data.ok) { notify('Failed to start feedback loop', 'error'); return; }

  const evtSource = new EventSource(`/api/feedback-loops/${data.loop_id}/stream`);
  evtSource.onmessage = async (event) => {
    const evt = JSON.parse(event.data);
    if (evt.type === 'log' && ['phase','done','error'].includes(evt.level)) {
      notify(evt.message, evt.level === 'error' ? 'error' : 'info');
    }
    if (evt.type === 'done') {
      evtSource.close();
      const flRes = await fetch(`/api/council/expert/${expertId}/feedback-loop`);
      const flData = await flRes.json();
      if (flData.result) {
        expertResults[expertId]._feedbackResult = flData.result;
        notify('Feedback loop complete', 'done');
        activeOutputTab = 'feedback';
        render();
      }
    }
  };
  evtSource.onerror = () => evtSource.close();
}

// ── Context Guardian ────────────────────────────────────────

async function runContextGuardian(expertId) {
  const checkboxes = document.querySelectorAll('.guardian-ctx-check:checked');
  const contexts = Array.from(checkboxes).map(cb => cb.value);
  const customText = document.getElementById('guardian-custom-ctx')?.value || '';
  if (contexts.length === 0 && !customText.trim()) {
    notify('Select at least one context or provide custom text', 'error');
    return;
  }
  notify(`Running Context Guardian (${contexts.length} contexts)...`, 'phase');
  try {
    const res = await fetch(`/api/council/expert/${expertId}/context-guardian`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexts, custom_text: customText }),
    });
    const data = await res.json();
    if (data.ok) {
      expertResults[expertId]._guardian = data.result;
      notify('Context Guardian analysis complete', 'done');
      activeOutputTab = 'guardian';
      render();
    } else notify(`Guardian error: ${data.error}`, 'error');
  } catch(e) { notify(`Guardian error: ${e.message}`, 'error'); }
}

// ── Synthesis Feedback Loop & Guardian ──────────────────────

async function runSynthesisFeedbackLoop() {
  notify('Starting feedback loop on synthesis...', 'phase');
  const res = await fetch('/api/synthesis/feedback-loop', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_rounds: 3 }),
  });
  const data = await res.json();
  if (!data.ok) { notify('Failed to start synthesis feedback loop', 'error'); return; }

  const evtSource = new EventSource(`/api/feedback-loops/${data.loop_id}/stream`);
  evtSource.onmessage = async (event) => {
    const evt = JSON.parse(event.data);
    if (evt.type === 'log' && ['phase','done','error'].includes(evt.level)) {
      notify(evt.message, evt.level === 'error' ? 'error' : 'info');
    }
    if (evt.type === 'done') {
      evtSource.close();
      await fetchSynthesisFeedback();
      notify('Synthesis feedback loop complete', 'done');
      activeSynthesisTab = 'feedback';
      render();
    }
  };
  evtSource.onerror = () => evtSource.close();
}

async function runSynthesisGuardian() {
  const checkboxes = document.querySelectorAll('.synth-guardian-ctx-check:checked');
  const contexts = Array.from(checkboxes).map(cb => cb.value);
  const customText = document.getElementById('synth-guardian-custom-ctx')?.value || '';
  if (contexts.length === 0 && !customText.trim()) {
    notify('Select at least one context or provide custom text', 'error');
    return;
  }
  notify(`Running Context Guardian on synthesis (${contexts.length} contexts)...`, 'phase');
  try {
    const res = await fetch('/api/synthesis/context-guardian', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexts, custom_text: customText }),
    });
    const data = await res.json();
    if (data.ok) {
      synthesisGuardian = data.result;
      notify('Synthesis Context Guardian complete', 'done');
      activeSynthesisTab = 'guardian';
      render();
    } else notify(`Guardian error: ${data.error}`, 'error');
  } catch(e) { notify(`Guardian error: ${e.message}`, 'error'); }
}

// ── Summarize ───────────────────────────────────────────────

async function summarizeExpert(expertId) {
  notify('Summarizing...', 'info');
  try {
    const res = await fetch(`/api/council/expert/${expertId}/summarize`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) { expertResults[expertId].summary = data.summary; notify('Summary ready', 'done'); render(); }
  } catch(e) { notify('Summary failed', 'error'); }
}

// ── Curate ──────────────────────────────────────────────────

async function curateOutput(expertId) {
  const result = expertResults[expertId];
  if (!result) return;
  if (curatedOutputs.find(c => c.expert_id === expertId)) { notify('Already in synthesis', 'info'); return; }
  try {
    const res = await fetch('/api/curated', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expert_id: expertId, role: result.role, content: result.content, phase_id: result.phase_id }),
    });
    const data = await res.json();
    if (data.ok) {
      curatedOutputs.push({ expert_id: expertId, role: result.role, content: result.content, phase_id: result.phase_id });
      notify(`${result.role} sent to synthesis`, 'done');
      render();
    }
  } catch(e) { notify('Failed to curate', 'error'); }
}

async function removeCuratedItem(expertId) {
  await fetch(`/api/curated/${expertId}`, { method: 'DELETE' });
  curatedOutputs = curatedOutputs.filter(c => c.expert_id !== expertId);
  render();
}

// ── Synthesis ───────────────────────────────────────────────

async function runSynthesis() {
  if (!curatedOutputs.length) { notify('No curated outputs', 'error'); return; }
  notify('Running synthesis...', 'phase');
  try {
    const res = await fetch('/api/curated/synthesize', { method: 'POST' });
    const data = await res.json();
    if (data.ok) { synthesisFull = data.synthesis.content; notify('Synthesis complete', 'done'); render(); }
    else notify(`Error: ${data.error}`, 'error');
  } catch(e) { notify('Synthesis failed', 'error'); }
}

async function extractFilmBrief() {
  notify('Extracting Film Brief...', 'phase');
  try {
    const res = await fetch('/api/film-brief/extract?stage=2', { method: 'POST' });
    const data = await res.json();
    if (data.ok) { filmBrief = data.brief; notify('Film Brief extracted', 'done'); render(); }
    else notify(`Error: ${data.error}`, 'error');
  } catch(e) { notify('Extraction failed', 'error'); }
}

// ── Modals ──────────────────────────────────────────────────

function openFilmBriefModal() {
  if (!filmBrief) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  let c = '';
  if (filmBrief.world_summary) c += `<div style="margin-bottom:1rem"><h4 style="color:var(--accent);margin-bottom:0.5rem">World Summary</h4><p style="font-size:0.85rem;line-height:1.7">${renderMarkdown(filmBrief.world_summary)}</p></div>`;
  if (filmBrief.narrative_arc) c += `<div style="margin-bottom:1rem"><h4 style="color:var(--accent);margin-bottom:0.5rem">Narrative Arc</h4><p style="font-size:0.85rem;line-height:1.7">${renderMarkdown(filmBrief.narrative_arc)}</p></div>`;

  if (filmBrief.characters?.length) {
    c += `<h4 style="color:var(--accent);margin-bottom:0.5rem">Characters (${filmBrief.characters.length})</h4>`;
    for (const ch of filmBrief.characters) {
      c += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.5rem">
        <strong>${escapeHtml(ch.name)}</strong> <span style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(ch.role||'')}</span>
        <p style="font-size:0.8rem;margin-top:0.25rem;color:var(--text-muted)">${escapeHtml(ch.description||'')}</p>
      </div>`;
    }
  }

  if (filmBrief.environments?.length) {
    c += `<h4 style="color:var(--accent);margin:1rem 0 0.5rem">Environments (${filmBrief.environments.length})</h4>`;
    for (const env of filmBrief.environments) {
      c += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.5rem">
        <strong>${escapeHtml(env.name)}</strong> <span style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(env.function||'')}</span>
        <p style="font-size:0.8rem;margin-top:0.25rem;color:var(--text-muted)">${escapeHtml(env.description||'')}</p>
      </div>`;
    }
  }

  if (filmBrief.scenes?.length) {
    c += `<h4 style="color:var(--accent);margin:1rem 0 0.5rem">Scenes (${filmBrief.scenes.length})</h4>`;
    for (const sc of filmBrief.scenes) {
      c += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.5rem">
        <strong>${escapeHtml(sc.title||`Scene ${sc.id}`)}</strong>
        <span style="color:var(--text-muted);font-size:0.7rem;margin-left:0.5rem">${escapeHtml(sc.location||'')} | ~${sc.duration_estimate||'?'}s</span>
        <p style="font-size:0.8rem;margin-top:0.25rem;color:var(--text-muted)">${escapeHtml(sc.description||'')}</p>
      </div>`;
    }
  }

  overlay.innerHTML = `<div class="modal" style="max-width:1000px"><div class="modal-header"><h3>Film Brief</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div><div class="modal-body">${c}</div></div>`;
  document.body.appendChild(overlay);
}

async function openExpertPromptModal(expertId) {
  const reg = expertRegistry?.find(e => e.id === expertId);
  if (!reg) return;
  let promptContent = '';
  try {
    const res = await fetch(`/api/council/expert/${expertId}`);
    const data = await res.json();
    promptContent = data.prompt || '';
  } catch(e) { notify('Failed to load prompt', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" style="max-width:700px">
      <div class="modal-header">
        <h3>${escapeHtml(reg.role)}</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <textarea id="expert-prompt-editor" rows="20"
          style="width:100%;padding:0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.8rem;font-family:'SF Mono','Fira Code',monospace;line-height:1.6;resize:vertical">${escapeHtml(promptContent)}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveExpertPrompt('${expertId}')">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveExpertPrompt(expertId) {
  const textarea = document.getElementById('expert-prompt-editor');
  if (!textarea) return;
  try {
    const res = await fetch(`/api/council/expert/${expertId}/prompt`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: textarea.value }),
    });
    const data = await res.json();
    if (data.ok) {
      document.querySelector('.modal-overlay')?.remove();
      notify('Prompt saved', 'done');
    } else notify(`Error: ${data.error}`, 'error');
  } catch(e) { notify('Failed to save prompt', 'error'); }
}

function openCreateExpertModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px">
      <div class="modal-header"><h3>Create Expert</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div>
      <div class="modal-body">
        <div class="create-expert-form">
          <div class="form-group"><label>Name</label><input id="new-expert-name" type="text" placeholder="e.g. Quantum Computing Researcher"></div>
          <div class="form-group"><label>Description</label><textarea id="new-expert-desc" rows="3" placeholder="What does this expert know?"></textarea></div>
          <div class="form-group"><label>Goals</label><textarea id="new-expert-goals" rows="2" placeholder="What should they produce?"></textarea></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="createExpert()">Create</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function createExpert() {
  const name = document.getElementById('new-expert-name')?.value;
  const description = document.getElementById('new-expert-desc')?.value;
  const goals = document.getElementById('new-expert-goals')?.value;
  if (!name || !description) { notify('Name and description required', 'error'); return; }
  notify('Creating expert...', 'info');
  try {
    const res = await fetch('/api/council/experts/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, goals: goals || '' }),
    });
    const data = await res.json();
    if (data.ok) {
      await fetchExpertRegistry();
      document.querySelector('.modal-overlay')?.remove();
      notify(`Expert "${name}" created`, 'done');
      render();
    } else notify(`Error: ${data.error}`, 'error');
  } catch(e) { notify('Failed to create expert', 'error'); }
}

function openResetModal() {
  if (!confirm('Reset all outputs? This clears expert results, synthesis, curated outputs, and Film Brief.')) return;
  resetAll();
}

async function resetAll() {
  try {
    await fetch('/api/stages/1/reset', { method: 'POST' });
    await fetch('/api/stages/2/reset', { method: 'POST' });
    await fetch('/api/curated/reset', { method: 'POST' });
    expertResults = {}; synthesisData = {}; curatedOutputs = [];
    synthesisFull = null; filmBrief = null; selectedOutputExpert = null;
    synthesisFeedback = null; synthesisGuardian = null; activeSynthesisTab = 'content';
    revisionVault = {};
    notify('All outputs cleared', 'done');
    render();
  } catch(e) { notify('Reset failed', 'error'); }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelector('.modal-overlay')?.remove();
});

document.addEventListener('DOMContentLoaded', init);
