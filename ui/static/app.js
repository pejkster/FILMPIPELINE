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
let feedbackLoopStatus = {}; // { expertId: { running, events[], startedAt, progress } }
let researchContextMode = 'basic'; // 'basic' | 'custom'
let customContextText = '';
let basicContextText = '';

let synthesisFeedback = null;
let synthesisGuardian = null;
let activeSynthesisTab = 'content'; // 'content' | 'feedback' | 'guardian'

const SYNTH_SECTIONS = [
  { id: 'executive_summary', label: 'Executive Summary' },
  { id: 'characters', label: 'Characters' },
  { id: 'environments', label: 'Environments' },
  { id: 'visual_identity', label: 'Visual Identity' },
  { id: 'script_shots', label: 'Script & Shots' },
];
let activeSynthSection = 'executive_summary';
let activeSynthSubTab = 'content'; // 'content' | 'feedback' | 'guardian'
let synthSections = {}; // { section_id: { content, feedbackResult, guardianResult } }
let synthSectionEditing = {}; // { section_id: true/false }

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
    fetchSynthesisFeedback(), fetchSynthesisGuardian(), fetchSynthSections(),
  ]);
  await fetchActiveJobs();
  render();
}

// ── Main Render ─────────────────────────────────────────────

function render() {
  const cols = document.querySelectorAll('.workspace-col');
  const scrolls = Array.from(cols).map(col => {
    const body = col.querySelector('.col-body');
    return body ? body.scrollTop : 0;
  });

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="workspace">
      <div class="workspace-col">${renderResearchColumn()}</div>
      <div class="workspace-col">${renderOutputsColumn()}</div>
      <div class="workspace-col">${renderSynthesisColumn()}</div>
    </div>
  `;

  const newCols = document.querySelectorAll('.workspace-col');
  newCols.forEach((col, i) => {
    const body = col.querySelector('.col-body');
    if (body && scrolls[i]) body.scrollTop = scrolls[i];
  });
}

function renderPreserveScroll() {
  render();
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

    if (activeOutputTab === 'summary') html += renderSummaryTab(result);
    else if (activeOutputTab === 'full') html += renderFullTab(result);
    else if (activeOutputTab === 'feedback') html += renderFeedbackTab(selectedOutputExpert, result);
    else if (activeOutputTab === 'guardian') html += renderGuardianTab(selectedOutputExpert, result);

    html += `</div>`;
  }

  // Vault at bottom — aggregated across all experts
  html += renderGlobalVault();

  return html;
}

function renderGlobalVault() {
  const allItems = [];
  for (const [expertId, items] of Object.entries(revisionVault)) {
    for (const item of items) {
      const expertName = expertResults[expertId]?.role || expertId;
      allItems.push({ ...item, expertId, expertName });
    }
  }
  if (allItems.length === 0) return '';

  return `<div class="global-vault">
    <details open>
      <summary class="global-vault-header">
        <span>Revision Vault (${allItems.length})</span>
      </summary>
      <div class="global-vault-items">
        ${allItems.map(item => `
          <div class="vault-item">
            <div class="vault-item-meta">
              <span class="vault-item-expert">${escapeHtml(item.expertName)}</span>
              <span class="vault-item-source">${escapeHtml(item.source)}</span>
            </div>
            <div class="vault-item-text">${escapeHtml(item.text)}</div>
            <button class="btn-icon" onclick="removeVaultItem('${item.expertId}', '${item.id}')" title="Remove">&times;</button>
          </div>
        `).join('')}
      </div>
      <div class="global-vault-actions">
        ${selectedOutputExpert ? `<button class="btn btn-xs btn-primary" onclick="sendForRevision('${selectedOutputExpert}')">Revise ${escapeHtml(expertResults[selectedOutputExpert]?.role || 'Selected')}</button>` : ''}
        <button class="btn btn-xs btn-ghost" onclick="clearAllVaults()">Clear All</button>
      </div>
    </details>
  </div>`;
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

function renderFeedbackConsole(expertId) {
  const status = feedbackLoopStatus[expertId];
  if (!status || !status.running && status.events.length === 0) return '';

  const elapsed = status.running ? Math.floor((Date.now() - status.startedAt) / 1000) : status.elapsedTotal || 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const pct = Math.min(100, Math.round((status.step / status.totalSteps) * 100));
  const barColor = status.running ? 'var(--accent)' : (status.error ? 'var(--danger)' : 'var(--success)');

  let html = `<div class="fl-console">
    <div class="fl-console-header">
      <span class="fl-console-title">${status.running ? '⟳ Running' : (status.error ? 'Failed' : 'Complete')}</span>
      <span class="fl-console-time">${timeStr}</span>
    </div>
    <div class="fl-progress-bar"><div class="fl-progress-fill" style="width:${pct}%;background:${barColor}"></div></div>
    <div class="fl-console-log" id="fl-console-log-${expertId}">`;
  for (const evt of status.events) {
    const lvlClass = evt.level === 'error' ? 'fl-log-error' : evt.level === 'phase' ? 'fl-log-phase' : evt.level === 'done' ? 'fl-log-done' : '';
    html += `<div class="fl-log-line ${lvlClass}"><span class="fl-log-time">${evt.time || ''}</span>${escapeHtml(evt.message)}</div>`;
  }
  html += `</div></div>`;
  return html;
}

function renderFeedbackTab(expertId, result) {
  let html = '';
  const fl = result._feedbackResult;

  html += renderFeedbackConsole(expertId);

  const status = feedbackLoopStatus[expertId];
  const isRunning = status?.running;

  if (!fl && !isRunning) {
    html += `<div style="padding:0.75rem">
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem">Run a multi-model feedback loop &mdash; 6 AI models debate and refine the output through blind peer review.</p>
      <button class="btn btn-primary" onclick="runFeedbackLoop('${expertId}')">Run Feedback Loop</button>
    </div>`;
    return html;
  }

  if (!fl) return html;

  if (fl.analysis) {
    const a = fl.analysis;
    html += `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
        <h5 style="font-size:0.8rem;color:var(--accent)">Multi-Model Analysis</h5>
        <span style="font-size:1.2rem;font-weight:700;${(a.score||0) >= 7 ? 'color:var(--success)' : (a.score||0) >= 4 ? 'color:var(--warning)' : 'color:var(--danger)'}">${a.score || '?'}/10</span>
      </div>
      ${a.summary ? `<div class="output-summary" style="margin-bottom:0.5rem">${escapeHtml(a.summary)}</div>` : ''}`;

    const categories = [
      { key: 'strengths', title: 'Strengths', color: 'var(--success)' },
      { key: 'concerns', title: 'Concerns', color: 'var(--danger)' },
      { key: 'suggestions', title: 'Suggestions', color: 'var(--info)' },
      { key: 'strongest_ideas', title: 'Strongest Ideas', color: 'var(--accent)' },
    ];
    for (const cat of categories) {
      const items = a[cat.key];
      if (items?.length) {
        html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${cat.color}">${cat.title}</h5>`;
        items.forEach((item, i) => {
          const itemId = item.id || `fl_${cat.key}_${i}`;
          const text = typeof item === 'string' ? item : item.text || `${item.theme}: ${item.detail}`;
          const inVault = (revisionVault[expertId] || []).find(v => v.id === itemId);
          html += renderFeedbackCard(expertId, itemId, text, `Feedback Loop — ${cat.title}`, inVault);
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
  const safeText = btoa(unescape(encodeURIComponent(text)));
  const safeSource = btoa(unescape(encodeURIComponent(source)));
  return `<div class="feedback-card ${inVault ? 'in-vault' : ''}" data-item-id="${itemId}">
    <div class="feedback-card-text">${escapeHtml(text)}</div>
    <button class="btn btn-xs ${inVault ? 'btn-danger-outline' : 'btn-ghost'}"
      onclick="toggleVaultItem('${expertId}', '${itemId}', '${safeText}', '${safeSource}')">
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

function toggleVaultItem(expertId, itemId, textB64, sourceB64) {
  const text = decodeURIComponent(escape(atob(textB64)));
  const source = decodeURIComponent(escape(atob(sourceB64)));
  if (!revisionVault[expertId]) revisionVault[expertId] = [];
  const idx = revisionVault[expertId].findIndex(v => v.id === itemId);
  if (idx >= 0) revisionVault[expertId].splice(idx, 1);
  else revisionVault[expertId].push({ id: itemId, text, source });
  renderPreserveScroll();
}

function removeVaultItem(expertId, itemId) {
  if (!revisionVault[expertId]) return;
  revisionVault[expertId] = revisionVault[expertId].filter(v => v.id !== itemId);
  render();
}

function clearVault(expertId) { revisionVault[expertId] = []; render(); }
function clearAllVaults() { revisionVault = {}; render(); }

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
  const hasCurated = curatedOutputs.length > 0;
  const hasAnySections = Object.keys(synthSections).length > 0;

  let html = `
    <div class="col-header">
      <h3>Synthesis</h3>
      <div style="display:flex;gap:0.25rem">
        ${hasCurated ? `<button class="btn btn-sm btn-primary" onclick="runSynthesis()">Synthesize</button>` : ''}
        ${hasAnySections ? `<button class="btn btn-sm" onclick="exportPDF()">Export PDF</button>` : ''}
      </div>
    </div>
    <div class="synth-tabs">
      ${SYNTH_SECTIONS.map(s => {
        const sec = synthSections[s.id];
        const hasContent = sec?.content;
        return `<button class="synth-tab ${activeSynthSection === s.id ? 'active' : ''}" onclick="setSynthSection('${s.id}')">
          ${s.label}${hasContent ? ' <span style="color:var(--success);font-size:0.6rem">&#9679;</span>' : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="col-body">
  `;

  if (!hasAnySections && !hasCurated) {
    html += `<div class="empty-state"><div class="empty-icon">&#x1F3AC;</div><p>Curate expert outputs from the middle column, then synthesize to populate these sections.</p></div>`;
  } else {
    html += renderSynthSectionBody();
  }

  if (hasCurated) {
    html += `<details style="padding:0.5rem;border-top:1px solid var(--border)">
      <summary style="font-size:0.72rem;cursor:pointer;color:var(--text-muted)">Curated Outputs (${curatedOutputs.length})</summary>`;
    for (const item of curatedOutputs) {
      html += `<div class="curated-item">
        <div class="curated-item-header">
          <span class="curated-item-role">${escapeHtml(item.role)}</span>
          <button class="btn btn-xs btn-danger-outline" onclick="removeCuratedItem('${item.expert_id}')">Remove</button>
        </div>
      </div>`;
    }
    html += `</details>`;
  }

  html += `</div>`;
  return html;
}

function setSynthSection(sectionId) { activeSynthSection = sectionId; activeSynthSubTab = 'content'; render(); }
function setSynthSubTab(tab) { activeSynthSubTab = tab; render(); }

function renderSynthSectionBody() {
  const sec = synthSections[activeSynthSection] || {};
  const sectionKey = `_synth_${activeSynthSection}`;
  const hasFeedback = !!sec.feedbackResult;
  const hasGuardian = !!sec.guardianResult;

  let html = `<div class="synth-sub-tabs">
    <button class="synth-sub-tab ${activeSynthSubTab === 'content' ? 'active' : ''}" onclick="setSynthSubTab('content')">Content</button>
    <button class="synth-sub-tab ${activeSynthSubTab === 'feedback' ? 'active' : ''}" onclick="setSynthSubTab('feedback')">Feedback Loop${hasFeedback ? ' &#10003;' : ''}</button>
    <button class="synth-sub-tab ${activeSynthSubTab === 'guardian' ? 'active' : ''}" onclick="setSynthSubTab('guardian')">Guardian${hasGuardian ? ' &#10003;' : ''}</button>
  </div>`;

  if (activeSynthSubTab === 'content') {
    html += renderSynthSectionContent(activeSynthSection, sec);
  } else if (activeSynthSubTab === 'feedback') {
    html += renderSynthSectionFeedback(activeSynthSection, sec);
  } else if (activeSynthSubTab === 'guardian') {
    html += renderSynthSectionGuardian(activeSynthSection, sec);
  }
  return html;
}

function renderSynthSectionContent(sectionId, sec) {
  const editing = synthSectionEditing[sectionId];
  let html = `<div class="synth-edit-bar">
    ${editing
      ? `<button class="btn btn-xs btn-primary" onclick="saveSynthSection('${sectionId}')">Save</button>
         <button class="btn btn-xs" onclick="cancelSynthEdit('${sectionId}')">Cancel</button>`
      : `<button class="btn btn-xs" onclick="editSynthSection('${sectionId}')">Edit</button>`}
  </div>`;

  if (editing) {
    html += `<div style="padding:0.5rem">
      <textarea class="synth-content-editor" id="synth-editor-${sectionId}">${escapeHtml(sec.content || '')}</textarea>
    </div>`;
  } else if (sec.content) {
    html += `<div class="synth-section-content">${renderMarkdown(sec.content)}</div>`;
  } else {
    html += `<div class="empty-state" style="padding:2rem"><p>No content yet. Run synthesis or click Edit to write manually.</p></div>`;
  }
  return html;
}

function renderSynthSectionFeedback(sectionId, sec) {
  const sectionKey = `_synth_${sectionId}`;
  let html = renderFeedbackConsole(sectionKey);

  const fl = sec.feedbackResult;
  const status = feedbackLoopStatus[sectionKey];
  const isRunning = status?.running;

  if (!fl && !isRunning) {
    html += `<div style="padding:0.75rem">
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem">Run a multi-model feedback loop on this section.</p>
      <button class="btn btn-primary" onclick="runSynthSectionFeedback('${sectionId}')" ${!sec.content ? 'disabled' : ''}>Run Feedback Loop</button>
    </div>`;
    return html;
  }
  if (!fl) return html;

  if (fl.analysis) {
    const a = fl.analysis;
    html += `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
        <h5 style="font-size:0.8rem;color:var(--accent)">Multi-Model Analysis</h5>
        <span style="font-size:1.2rem;font-weight:700;${(a.score||0) >= 7 ? 'color:var(--success)' : (a.score||0) >= 4 ? 'color:var(--warning)' : 'color:var(--danger)'}">${a.score || '?'}/10</span>
      </div>
      ${a.summary ? `<div class="output-summary" style="margin-bottom:0.5rem">${escapeHtml(a.summary)}</div>` : ''}`;

    const categories = [
      { key: 'strengths', title: 'Strengths', color: 'var(--success)' },
      { key: 'concerns', title: 'Concerns', color: 'var(--danger)' },
      { key: 'suggestions', title: 'Suggestions', color: 'var(--info)' },
      { key: 'strongest_ideas', title: 'Strongest Ideas', color: 'var(--accent)' },
    ];
    for (const cat of categories) {
      const items = a[cat.key];
      if (items?.length) {
        html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${cat.color}">${cat.title}</h5>`;
        items.forEach((item, i) => {
          const itemId = item.id || `sfl_${cat.key}_${i}`;
          const text = typeof item === 'string' ? item : item.text || '';
          const inVault = (revisionVault[sectionKey] || []).find(v => v.id === itemId);
          html += renderFeedbackCard(sectionKey, itemId, text, `${SYNTH_SECTIONS.find(s=>s.id===sectionId)?.label} Feedback — ${cat.title}`, inVault);
        });
        html += `</div>`;
      }
    }
    html += `</div>`;
  }

  html += `<div style="padding:0.5rem"><button class="btn btn-sm" onclick="runSynthSectionFeedback('${sectionId}')">Re-run Feedback Loop</button></div>`;
  return html;
}

function renderSynthSectionGuardian(sectionId, sec) {
  const guardian = sec.guardianResult;
  let html = `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
      <span style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:600">Check against:</span>
      ${availableContexts.map(ctx => `
        <label style="display:flex;align-items:center;gap:0.25rem;font-size:0.72rem;cursor:pointer">
          <input type="checkbox" class="synth-sec-guardian-ctx" value="${escapeAttr(ctx.id)}"
            ${['disordine','futurax'].includes(ctx.id) ? 'checked' : ''} style="accent-color:var(--accent)">
          ${escapeHtml(ctx.name)}
        </label>
      `).join('')}
    </div>
    <button class="btn btn-sm btn-primary" onclick="runSynthSectionGuardian('${sectionId}')" style="margin-top:0.25rem"
      ${!sec.content ? 'disabled' : ''}>
      ${guardian ? 'Re-run' : 'Run'} Context Guardian
    </button>
  </div>`;

  if (!guardian) {
    html += `<div style="padding:0.75rem"><div class="empty-state"><p>Select contexts above and run the guardian.</p></div></div>`;
    return html;
  }

  if (guardian.sections) {
    for (const section of guardian.sections) {
      html += `<div style="padding:0.75rem;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
          <h5 style="font-size:0.8rem;color:var(--accent)">${escapeHtml(section.context_name)}</h5>
          <span style="font-size:1.2rem;font-weight:700;${section.score >= 7 ? 'color:var(--success)' : section.score >= 4 ? 'color:var(--warning)' : 'color:var(--danger)'}">${section.score}/10</span>
        </div>`;
      const categories = [
        { key: 'strengths', title: 'Strengths', color: 'var(--success)' },
        { key: 'concerns', title: 'Concerns', color: 'var(--danger)' },
        { key: 'suggestions', title: 'Suggestions', color: 'var(--info)' },
        { key: 'missing_elements', title: 'Missing Elements', color: 'var(--warning)' },
      ];
      for (const cat of categories) {
        if (section[cat.key]?.length) {
          html += `<div class="feedback-section"><h5 class="feedback-section-title" style="color:${cat.color}">${cat.title}</h5>`;
          const sectionKey = `_synth_${sectionId}`;
          section[cat.key].forEach(item => {
            const inVault = (revisionVault[sectionKey] || []).find(v => v.id === item.id);
            html += renderFeedbackCard(sectionKey, item.id, item.text, `Guardian — ${section.context_name}`, inVault);
          });
          html += `</div>`;
        }
      }
      html += `</div>`;
    }
  }
  return html;
}

function editSynthSection(sectionId) { synthSectionEditing[sectionId] = true; render(); }
function cancelSynthEdit(sectionId) { synthSectionEditing[sectionId] = false; render(); }

async function saveSynthSection(sectionId) {
  const textarea = document.getElementById(`synth-editor-${sectionId}`);
  if (!textarea) return;
  const content = textarea.value;
  if (!synthSections[sectionId]) synthSections[sectionId] = {};
  synthSections[sectionId].content = content;
  synthSectionEditing[sectionId] = false;

  try {
    await fetch(`/api/synthesis/sections/${sectionId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch(e) { notify('Failed to save section', 'error'); }
  render();
}

function setSynthesisTab(tab) { activeSynthesisTab = tab; render(); }

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
  // 6 models × (statement + feedback + revision) × max_rounds + analysis
  const totalSteps = 6 + (6 + 6) * 3 + 1;
  feedbackLoopStatus[expertId] = {
    running: true, events: [], startedAt: Date.now(),
    step: 0, totalSteps, error: false, elapsedTotal: 0,
  };
  activeOutputTab = 'feedback';
  render();

  const res = await fetch(`/api/council/expert/${expertId}/feedback-loop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_rounds: 3 }),
  });
  const data = await res.json();
  if (!data.ok) {
    feedbackLoopStatus[expertId].running = false;
    feedbackLoopStatus[expertId].error = true;
    feedbackLoopStatus[expertId].events.push({ time: '', message: 'Failed to start', level: 'error' });
    render();
    return;
  }

  // Timer to update elapsed time display
  const timer = setInterval(() => {
    if (!feedbackLoopStatus[expertId]?.running) { clearInterval(timer); return; }
    updateFeedbackConsole(expertId);
  }, 1000);

  const evtSource = new EventSource(`/api/feedback-loops/${data.loop_id}/stream`);
  evtSource.onmessage = async (event) => {
    const evt = JSON.parse(event.data);
    const status = feedbackLoopStatus[expertId];
    if (!status) return;

    if (evt.type === 'log') {
      status.events.push({ time: evt.time, message: evt.message, level: evt.level });
      if (['start', 'done'].includes(evt.level)) status.step++;
      updateFeedbackConsole(expertId);
    }
    if (evt.type === 'done') {
      clearInterval(timer);
      evtSource.close();
      status.running = false;
      status.error = evt.status === 'error';
      status.elapsedTotal = Math.floor((Date.now() - status.startedAt) / 1000);
      const flRes = await fetch(`/api/council/expert/${expertId}/feedback-loop`);
      const flData = await flRes.json();
      if (flData.result) {
        expertResults[expertId]._feedbackResult = flData.result;
        render();
      } else {
        updateFeedbackConsole(expertId);
      }
    }
  };
  evtSource.onerror = () => { clearInterval(timer); evtSource.close(); };
}

function updateFeedbackConsole(expertId) {
  const container = document.getElementById(`fl-console-log-${expertId}`);
  const headerEl = document.querySelector('.fl-console-header');
  const progressEl = document.querySelector('.fl-progress-fill');
  const status = feedbackLoopStatus[expertId];
  if (!status) return;

  if (container) {
    let logHtml = '';
    for (const evt of status.events) {
      const lvlClass = evt.level === 'error' ? 'fl-log-error' : evt.level === 'phase' ? 'fl-log-phase' : evt.level === 'done' ? 'fl-log-done' : '';
      logHtml += `<div class="fl-log-line ${lvlClass}"><span class="fl-log-time">${evt.time || ''}</span>${escapeHtml(evt.message)}</div>`;
    }
    container.innerHTML = logHtml;
    container.scrollTop = container.scrollHeight;
  }

  const elapsed = status.running ? Math.floor((Date.now() - status.startedAt) / 1000) : status.elapsedTotal || 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  if (headerEl) {
    headerEl.querySelector('.fl-console-title').textContent = status.running ? '⟳ Running' : (status.error ? 'Failed' : 'Complete');
    headerEl.querySelector('.fl-console-time').textContent = timeStr;
  }
  if (progressEl) {
    const pct = Math.min(100, Math.round((status.step / status.totalSteps) * 100));
    progressEl.style.width = `${pct}%`;
    progressEl.style.background = status.running ? 'var(--accent)' : (status.error ? 'var(--danger)' : 'var(--success)');
  }
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

// ── Synthesis Section Feedback Loop & Guardian ───────────────

async function runSynthSectionFeedback(sectionId) {
  const sec = synthSections[sectionId];
  if (!sec?.content) { notify('No content in this section', 'error'); return; }

  const sectionKey = `_synth_${sectionId}`;
  const totalSteps = 6 + (6 + 6) * 3 + 1;
  feedbackLoopStatus[sectionKey] = {
    running: true, events: [], startedAt: Date.now(),
    step: 0, totalSteps, error: false, elapsedTotal: 0,
  };
  activeSynthSubTab = 'feedback';
  render();

  const label = SYNTH_SECTIONS.find(s => s.id === sectionId)?.label || sectionId;
  const res = await fetch(`/api/synthesis/sections/${sectionId}/feedback-loop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_rounds: 3 }),
  });
  const data = await res.json();
  if (!data.ok) {
    feedbackLoopStatus[sectionKey].running = false;
    feedbackLoopStatus[sectionKey].error = true;
    feedbackLoopStatus[sectionKey].events.push({ time: '', message: 'Failed to start', level: 'error' });
    render();
    return;
  }

  const timer = setInterval(() => {
    if (!feedbackLoopStatus[sectionKey]?.running) { clearInterval(timer); return; }
    updateFeedbackConsole(sectionKey);
  }, 1000);

  const evtSource = new EventSource(`/api/feedback-loops/${data.loop_id}/stream`);
  evtSource.onmessage = async (event) => {
    const evt = JSON.parse(event.data);
    const status = feedbackLoopStatus[sectionKey];
    if (!status) return;

    if (evt.type === 'log') {
      status.events.push({ time: evt.time, message: evt.message, level: evt.level });
      if (['start', 'done'].includes(evt.level)) status.step++;
      updateFeedbackConsole(sectionKey);
    }
    if (evt.type === 'done') {
      clearInterval(timer);
      evtSource.close();
      status.running = false;
      status.error = evt.status === 'error';
      status.elapsedTotal = Math.floor((Date.now() - status.startedAt) / 1000);
      const flRes = await fetch(`/api/synthesis/sections/${sectionId}/feedback-loop`);
      const flData = await flRes.json();
      if (flData.result) {
        if (!synthSections[sectionId]) synthSections[sectionId] = {};
        synthSections[sectionId].feedbackResult = flData.result;
        render();
      } else {
        updateFeedbackConsole(sectionKey);
      }
    }
  };
  evtSource.onerror = () => { clearInterval(timer); evtSource.close(); };
}

async function runSynthSectionGuardian(sectionId) {
  const sec = synthSections[sectionId];
  if (!sec?.content) { notify('No content in this section', 'error'); return; }

  const checkboxes = document.querySelectorAll('.synth-sec-guardian-ctx:checked');
  const contexts = Array.from(checkboxes).map(cb => cb.value);
  if (contexts.length === 0) { notify('Select at least one context', 'error'); return; }

  const label = SYNTH_SECTIONS.find(s => s.id === sectionId)?.label || sectionId;
  notify(`Running Guardian on ${label}...`, 'phase');
  try {
    const res = await fetch(`/api/synthesis/sections/${sectionId}/guardian`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexts }),
    });
    const data = await res.json();
    if (data.ok) {
      if (!synthSections[sectionId]) synthSections[sectionId] = {};
      synthSections[sectionId].guardianResult = data.result;
      notify('Guardian complete', 'done');
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
  notify('Running synthesis — splitting into sections...', 'phase');
  try {
    const res = await fetch('/api/curated/synthesize', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      synthesisFull = data.synthesis.content;
      notify('Splitting into sections...', 'info');
      try { await fetch('/api/synthesis/split-sections', { method: 'POST' }); } catch(e) {}
      await fetchSynthSections();
      notify('Synthesis complete', 'done');
      render();
    } else notify(`Error: ${data.error}`, 'error');
  } catch(e) { notify('Synthesis failed', 'error'); }
}

async function fetchSynthSections() {
  try {
    const res = await fetch('/api/synthesis/sections');
    const data = await res.json();
    if (data.ok) {
      for (const [id, sec] of Object.entries(data.sections)) {
        if (!synthSections[id]) synthSections[id] = {};
        synthSections[id].content = sec.content || '';
        if (sec.feedbackResult) synthSections[id].feedbackResult = sec.feedbackResult;
        if (sec.guardianResult) synthSections[id].guardianResult = sec.guardianResult;
      }
    }
  } catch(e) {}
}

async function exportPDF() {
  notify('Generating PDF...', 'phase');
  try {
    const res = await fetch('/api/synthesis/export-pdf', { method: 'POST' });
    if (!res.ok) { notify('PDF export failed', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metanoia-synthesis.pdf';
    a.click();
    URL.revokeObjectURL(url);
    notify('PDF downloaded', 'done');
  } catch(e) { notify('PDF export failed', 'error'); }
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
    revisionVault = {}; synthSections = {}; synthSectionEditing = {};
    notify('All outputs cleared', 'done');
    render();
  } catch(e) { notify('Reset failed', 'error'); }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelector('.modal-overlay')?.remove();
});

document.addEventListener('DOMContentLoaded', init);
