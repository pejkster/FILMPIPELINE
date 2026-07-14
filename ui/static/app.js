// ── Global state ────────────────────────────────────────────
let pipelineData = null;
let councilData = null;
let selectedStage = null;
let activeTab = 'generate';
let currentJobId = null;
let selectedExpert = null;
let activeEvtSource = null;
let expertResults = {};
let synthesisData = null;
let runningExperts = new Set();

const consoleLogs = [];
let consoleStatus = null;

async function fetchPipeline() {
  const res = await fetch('/api/pipeline');
  pipelineData = await res.json();
  const councilRes = await fetch('/api/council/phases');
  councilData = await councilRes.json();
  await fetchExpertResults();
  await fetchSynthesis();
  render();
}

async function fetchExpertResults() {
  try {
    const res = await fetch('/api/council/results');
    const data = await res.json();
    expertResults = {};
    for (const r of data.results) expertResults[r.expert_id] = r;
  } catch (e) {}
}

async function fetchSynthesis() {
  try {
    const res = await fetch('/api/council/synthesis');
    const data = await res.json();
    synthesisData = data.synthesis;
  } catch (e) {}
}

function render() {
  renderStages();
  renderDetailPanel();
  renderConsole();
}

// ── Stage cards ─────────────────────────────────────────────

function renderStages() {
  const flow = document.getElementById('pipeline-flow');
  flow.innerHTML = '';
  pipelineData.stages.forEach((stage, i) => {
    if (i > 0) {
      const prev = pipelineData.stages[i - 1].status;
      const c = document.createElement('div');
      c.className = `pipeline-connector ${prev === 'approved' ? 'passed' : ''}`;
      c.innerHTML = prev === 'approved' ? '→' : '⋯';
      flow.appendChild(c);
    }
    const card = document.createElement('div');
    card.className = 'stage-card';
    if (selectedStage === stage.stage) card.style.borderColor = stage.color;
    card.onclick = () => { selectedStage = stage.stage; selectedExpert = null; render(); };
    card.innerHTML = `
      <div class="stage-header">
        <div class="stage-icon" style="background:${stage.color}20">${stage.icon}</div>
        <div class="stage-info"><h2>Stage ${stage.stage}: ${stage.name}</h2><p>${stage.description}</p></div>
      </div>
      <div class="stage-body">
        <span class="status-badge status-${stage.status}">${stage.status}</span>
        <div class="stage-stats">
          <div class="stat"><span class="stat-value">${stage.artifact_count}</span><span class="stat-label">Artifacts</span></div>
          <div class="stat"><span class="stat-value">${stage.artifacts.filter(a=>a.approval==='approved').length}</span><span class="stat-label">Approved</span></div>
          <div class="stat"><span class="stat-value">${stage.artifacts.filter(a=>a.approval==='pending').length}</span><span class="stat-label">Pending</span></div>
        </div>
      </div>`;
    flow.appendChild(card);
  });
}

// ── Detail panel ────────────────────────────────────────────

function renderDetailPanel() {
  const panel = document.getElementById('detail-content');
  if (!selectedStage) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">←</div><p>Select a stage to get started</p></div>';
    return;
  }
  const stage = pipelineData.stages.find(s => s.stage === selectedStage);
  const expertCount = Object.keys(expertResults).length;
  const tabs = [
    { id: 'generate', label: selectedStage === 1 ? 'Council' : 'Generate' },
    { id: 'progress', label: `Progress${expertCount > 0 ? ` (${expertCount})` : ''}` },
    { id: 'artifacts', label: `Artifacts (${stage.artifact_count})` },
    { id: 'config', label: 'Config' },
  ];
  const tabsHtml = tabs.map(t =>
    `<button class="tab ${activeTab === t.id ? 'active' : ''}" onclick="activeTab='${t.id}'; selectedExpert=null; render();">${t.label}</button>`
  ).join('');

  let contentHtml = '';
  if (activeTab === 'generate') contentHtml = renderGeneratePanel(stage);
  else if (activeTab === 'progress') contentHtml = renderProgressPanel(stage);
  else if (activeTab === 'artifacts') contentHtml = renderArtifacts(stage);
  else if (activeTab === 'config') contentHtml = `<div class="config-panel">${formatConfig(stage.config)}</div>`;

  panel.innerHTML = `
    <div class="detail-header">
      <h3>${stage.icon} ${stage.name}</h3>
      <span class="status-badge status-${stage.status}">${stage.status}</span>
    </div>
    <div class="tab-bar">${tabsHtml}</div>
    <div id="tab-content">${contentHtml}</div>`;
}

// ── Console ─────────────────────────────────────────────────

function renderConsole() {
  const logEl = document.getElementById('console-log');
  const statusEl = document.getElementById('console-status');
  if (!logEl) return;
  logEl.innerHTML = '';
  if (consoleLogs.length === 0) {
    logEl.innerHTML = '<div class="console-empty">Run a phase to see live progress here</div>';
  } else {
    consoleLogs.forEach(e => logEl.appendChild(makeConsoleLine(e)));
    logEl.scrollTop = logEl.scrollHeight;
  }
  if (statusEl) {
    if (consoleStatus) {
      statusEl.textContent = consoleStatus.text;
      statusEl.className = `console-status ${consoleStatus.cls}`;
      statusEl.style.display = '';
    } else {
      statusEl.style.display = consoleLogs.length ? '' : 'none';
      if (consoleLogs.length) { statusEl.textContent = 'Idle'; statusEl.className = 'console-status'; }
    }
  }
}

function makeConsoleLine(entry) {
  const line = document.createElement('div');
  line.className = `console-line console-${entry.level || 'info'}`;
  const icons = { phase:'▶ ', start:'  ◦ ', done:'  ● ', preview:'    ', save:'  💾 ', checkpoint:'  🔒 ', error:'  ✕ ' };
  line.innerHTML = `<span class="console-time">${entry.time}</span>${icons[entry.level]||'  '}${escapeHtml(entry.message)}`;
  return line;
}

function consolePush(entry) {
  consoleLogs.push(entry);
  const logEl = document.getElementById('console-log');
  if (!logEl) return;
  const empty = logEl.querySelector('.console-empty');
  if (empty) empty.remove();
  logEl.appendChild(makeConsoleLine(entry));
  logEl.scrollTop = logEl.scrollHeight;
}

function clearConsole() { consoleLogs.length = 0; consoleStatus = null; renderConsole(); }

// ── Generate panel ──────────────────────────────────────────

function renderGeneratePanel(stage) {
  if (stage.stage === 1) return renderCouncilPanel();
  if (stage.stage === 2) return renderWorldbuildingGenerate();
  if (stage.stage === 3) return renderProductionGenerate();
  return '';
}

function renderCouncilPanel() {
  if (!councilData) return '<div class="generate-panel"><p>Loading...</p></div>';
  if (selectedExpert) return renderExpertDetail();

  const phases = councilData.phases;
  let html = '<div class="council-phases">';
  phases.forEach((phase, i) => {
    const sc = { idle:'var(--text-muted)', pending:'var(--info)', approved:'var(--success)', rejected:'var(--danger)' };
    const si = { idle:'○', pending:'◐', approved:'●', rejected:'✕' };
    html += `
      <div class="council-phase phase-active">
        <div class="phase-header">
          <div class="phase-status" style="color:${sc[phase.status]}">${si[phase.status]}</div>
          <div class="phase-title"><h4>${phase.name}</h4><p>${phase.description}</p></div>
          <span class="status-badge status-${phase.status}">${phase.status}</span>
        </div>
        <div class="phase-experts">
          ${phase.experts.map(e => {
            const done = !!expertResults[e.id];
            const running = runningExperts.has(e.id);
            const cls = running ? 'running' : done ? 'has-result' : '';
            return `<span class="expert-chip clickable ${cls}" onclick="event.stopPropagation(); loadExpert('${e.id}')">${e.role}</span>`;
          }).join('')}
        </div>
        <div class="phase-actions">
          <button class="btn btn-primary" onclick="event.stopPropagation(); runCouncilPhase('${phase.id}')" id="btn-phase-${phase.id}">${phase.status === 'idle' ? 'Run Phase' : 'Re-run'}</button>
          ${phase.status === 'pending' && phase.checkpoint ? `<button class="btn btn-approve btn-sm" onclick="event.stopPropagation(); approvePhase('${phase.id}')">Approve</button>` : ''}
        </div>
      </div>`;
    if (i < phases.length - 1) html += `<div class="council-connector ${phase.status === 'approved' ? 'passed' : ''}">${phase.status === 'approved' ? '↓' : '⋮'}</div>`;
  });
  return html + '</div>';
}

// ── Progress tab ────────────────────────────────────────────

function renderProgressPanel(stage) {
  if (stage.stage !== 1 || !councilData) return '<div class="empty-state"><p>Progress tracking for LLM Council.</p></div>';

  const totalExperts = councilData.phases.reduce((s, p) => s + p.experts.length, 0);
  const doneExperts = Object.keys(expertResults).length;

  let html = '<div class="progress-panel">';

  // Top bar with clear button
  html += `<div class="progress-top-bar">
    <span class="progress-overall">${doneExperts}/${totalExperts} experts complete</span>
    <div class="progress-top-actions">
      ${doneExperts > 0 ? `<button class="btn btn-sm btn-danger-outline" onclick="clearAllResults()">Clear All Results</button>` : ''}
    </div>
  </div>`;

  councilData.phases.forEach(phase => {
    const phaseDone = phase.experts.filter(e => !!expertResults[e.id]).length;
    html += `<div class="progress-phase">
      <div class="progress-phase-header">
        <h4>${phase.name}</h4>
        <span class="progress-count">${phaseDone}/${phase.experts.length}</span>
      </div>
      <div class="progress-experts">`;

    phase.experts.forEach(e => {
      const result = expertResults[e.id];
      const isRunning = runningExperts.has(e.id);

      if (result) {
        const summary = extractSummary(result.content);
        html += `
          <div class="progress-expert done" onclick="openExpertModal('${e.id}')">
            <div class="progress-expert-header">
              <span class="progress-expert-name">${e.role}</span>
              <span class="progress-expert-meta">${result.content.length} chars · ${new Date(result.timestamp).toLocaleTimeString()}</span>
            </div>
            <ul class="progress-summary">${summary}</ul>
          </div>`;
      } else if (isRunning) {
        html += `
          <div class="progress-expert is-running">
            <div class="progress-expert-header">
              <span class="progress-expert-name">${e.role}</span>
              <span class="progress-expert-meta">generating...</span>
            </div>
          </div>`;
      } else {
        html += `
          <div class="progress-expert queued">
            <div class="progress-expert-header">
              <span class="progress-expert-name">${e.role}</span>
              <span class="progress-expert-meta">queued</span>
            </div>
          </div>`;
      }
    });
    html += '</div></div>';
  });
  return html + '</div>';
}

function extractSummary(content) {
  // Extract section headers and their first substantive bullet/sentence
  const lines = content.split('\n');
  const items = [];
  let currentHeader = null;

  for (let i = 0; i < lines.length && items.length < 6; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) {
      currentHeader = line.replace(/^#+\s*/, '');
    } else if (currentHeader && line.length > 20 && !line.startsWith('#') && !line.startsWith('```')) {
      // First substantive line after a header
      let text = line.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '');
      items.push(`<li><strong>${escapeHtml(currentHeader)}:</strong> ${escapeHtml(text)}</li>`);
      currentHeader = null;
    }
  }

  if (items.length === 0) {
    const meaningful = lines.filter(l => l.trim().length > 20).slice(0, 4);
    return meaningful.map(l => `<li>${escapeHtml(l.trim())}</li>`).join('');
  }
  return items.join('');
}

async function clearAllResults() {
  if (!confirm('Clear all expert results? This cannot be undone.')) return;
  await fetch('/api/council/results/clear', { method: 'POST' });
  showToast('Results cleared');
  await fetchPipeline();
}

// ── Expert output modal ─────────────────────────────────────

async function openExpertModal(expertId) {
  const result = expertResults[expertId];
  if (!result) return;

  let meta = {};
  try { const res = await fetch(`/api/council/expert/${expertId}`); meta = await res.json(); } catch(e) {}

  const summary = generateSmartSummary(result.content);
  const modal = document.getElementById('expert-modal');
  const body = document.getElementById('expert-modal-body');

  body.innerHTML = `
    <div class="modal-header-bar">
      <div>
        <h2 class="modal-title">${result.role}</h2>
        <p class="modal-subtitle">Phase: ${meta.phase_name || result.phase_id} · ${result.content.length} chars · ${new Date(result.timestamp).toLocaleString()}</p>
      </div>
      <button class="btn btn-sm" onclick="closeExpertModal()">Close</button>
    </div>
    <div class="modal-tabs">
      <button class="gen-tab active" onclick="showModalTab(this, 'modal-summary')">Summary</button>
      <button class="gen-tab" onclick="showModalTab(this, 'modal-full')">Full Output</button>
    </div>
    <div id="modal-summary" class="modal-content-area">
      <div class="modal-summary-card">
        <h4>Key Points & Takeaways</h4>
        <div class="modal-summary-list">${summary}</div>
      </div>
    </div>
    <div id="modal-full" class="modal-content-area" style="display:none;">
      <div class="modal-full-output">${renderMarkdown(result.content)}</div>
    </div>`;

  modal.classList.add('visible');
}

function closeExpertModal() { document.getElementById('expert-modal').classList.remove('visible'); }

function showModalTab(btn, tabId) {
  const modal = document.getElementById('expert-modal-body');
  modal.querySelectorAll('.modal-content-area').forEach(el => el.style.display = 'none');
  modal.querySelectorAll('.gen-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).style.display = 'block';
}

function generateSmartSummary(content) {
  const lines = content.split('\n');
  const sections = [];
  let cur = null;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('## ')) {
      if (cur) sections.push(cur);
      cur = { title: t.replace(/^#+\s*/, ''), points: [] };
    } else if (cur && cur.points.length < 3) {
      const cleaned = t.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '');
      if (cleaned.length > 25) {
        cur.points.push(cleaned);
      }
    }
  }
  if (cur) sections.push(cur);

  if (sections.length === 0) {
    return lines.filter(l => l.trim().length > 20).slice(0, 5).map(l => `<div class="summary-item">${escapeHtml(l.trim())}</div>`).join('');
  }

  let html = '';
  for (const s of sections.slice(0, 10)) {
    html += `<div class="summary-section">
      <div class="summary-section-title">${escapeHtml(s.title)}</div>
      ${s.points.length > 0 ? '<ul>' + s.points.map(p => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>' : ''}
    </div>`;
  }
  return html;
}

// ── Artifacts tab (restructured with cards) ─────────────────

function renderArtifacts(stage) {
  if (stage.stage !== 1) {
    // Non-council stages keep the old artifact list
    return renderArtifactList(stage);
  }

  // Council stage: show synthesis + expert cards
  const expertCount = Object.keys(expertResults).length;
  if (expertCount === 0) return '<div class="empty-state"><div class="empty-icon">📭</div><p>No results yet. Run a phase to generate content.</p></div>';

  let html = '<div class="results-panel">';

  // Synthesis section at top
  html += '<div class="synthesis-section">';
  if (synthesisData) {
    html += `
      <div class="synthesis-card">
        <div class="synthesis-header">
          <h4>Synthesis — Key Takeaways</h4>
          <button class="btn btn-sm" onclick="runSynthesis()">Re-synthesize</button>
        </div>
        <div class="synthesis-content">${renderMarkdown(synthesisData.content)}</div>
      </div>`;
  } else {
    html += `
      <div class="synthesis-card synthesis-empty">
        <p>${expertCount} expert outputs ready for synthesis</p>
        <button class="btn btn-primary" onclick="runSynthesis()" id="btn-synth">Generate Synthesis</button>
      </div>`;
  }
  html += '</div>';

  // Expert result cards grid
  html += '<div class="results-grid">';
  if (councilData) {
    councilData.phases.forEach(phase => {
      phase.experts.forEach(e => {
        const result = expertResults[e.id];
        if (!result) return;
        const firstLine = result.content.split('\n').find(l => l.trim().length > 20);
        const preview = firstLine ? firstLine.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '').substring(0, 100) : '';
        html += `
          <div class="result-card" onclick="openExpertModal('${e.id}')">
            <div class="result-card-header">
              <span class="result-card-role">${e.role}</span>
              <span class="result-card-phase">${phase.name}</span>
            </div>
            <p class="result-card-preview">${escapeHtml(preview)}...</p>
            <div class="result-card-meta">${result.content.length} chars · ${new Date(result.timestamp).toLocaleTimeString()}</div>
          </div>`;
      });
    });
  }
  html += '</div></div>';
  return html;
}

function renderArtifactList(stage) {
  if (stage.artifacts.length === 0) return '<div class="empty-state"><div class="empty-icon">📭</div><p>No artifacts yet.</p></div>';
  let html = '<ul class="artifact-list">';
  stage.artifacts.forEach(a => {
    const created = new Date(a.created_at).toLocaleString();
    const images = a.content?.images || a.content?.views || [];
    const hasExperts = a.content?.expert_outputs?.length > 0;
    const label = a.content?.label || a.content?.name || a.content?.phase_name || a.type;
    html += `<li class="artifact-item-full">
      <div class="artifact-row">
        <div class="artifact-info"><span class="artifact-type">${label}</span><span class="artifact-meta">${a.type} · v${a.version} · ${created}</span></div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span class="status-badge status-${a.approval}">${a.approval}</span>
          <div class="artifact-actions">
            <button class="btn btn-sm btn-approve" onclick="updateArtifact(${stage.stage},'${a._filename}','approve')">✓</button>
            <button class="btn btn-sm btn-revise" onclick="updateArtifact(${stage.stage},'${a._filename}','revision')">↻</button>
            <button class="btn btn-sm btn-reject" onclick="updateArtifact(${stage.stage},'${a._filename}','reject')">✕</button>
            <button class="btn btn-sm" onclick="deleteArtifact(${stage.stage},'${a._filename}')" style="color:var(--text-muted)">🗑</button>
          </div>
        </div>
      </div>
      ${images.length > 0 ? renderImageGrid(images) : ''}
      ${hasExperts ? renderExpertOutputs(a.content.expert_outputs) : ''}
    </li>`;
  });
  return html + '</ul>';
}

async function runSynthesis() {
  const btn = document.getElementById('btn-synth');
  if (btn) { btn.disabled = true; btn.textContent = 'Synthesizing...'; }
  showToast('Running synthesis...');
  try {
    const res = await fetch('/api/council/synthesize', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      synthesisData = data.synthesis;
      showToast('Synthesis complete');
      render();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Synthesis'; }
  }
}

function renderExpertOutputs(outputs) {
  let html = '<div class="expert-outputs">';
  outputs.forEach(o => {
    const preview = o.content.substring(0, 200).replace(/[#*`]/g, '');
    html += `<div class="expert-output-card" onclick="this.classList.toggle('expanded')">
        <div class="expert-output-header"><span class="expert-output-role">${o.role}</span><span class="expert-output-meta">${o.content.length} chars</span></div>
        <div class="expert-output-preview">${escapeHtml(preview)}...</div>
        <div class="expert-output-full">${renderMarkdown(o.content)}</div>
      </div>`;
  });
  return html + '</div>';
}

function renderImageGrid(images) {
  let html = '<div class="image-grid">';
  images.forEach(img => {
    const url = img.url || img.imageURL; const label = img.view || '';
    if (url) html += `<div class="image-thumb" onclick="openLightbox('${url}')"><img src="${url}" alt="${label}" loading="lazy">${label ? `<span class="image-label">${label}</span>` : ''}</div>`;
  });
  return html + '</div>';
}

// ── Expert detail (Council tab) ─────────────────────────────

function renderExpertDetail() {
  return `<div class="expert-detail" id="expert-detail-container"><div class="empty-state"><p>Loading...</p></div></div>`;
}

async function loadExpert(expertId) {
  selectedExpert = expertId;
  render();
  const res = await fetch(`/api/council/expert/${expertId}`);
  const data = await res.json();
  const container = document.getElementById('expert-detail-container');
  if (!container) return;
  const result = expertResults[expertId];
  const hasOutput = result && result.content;

  container.innerHTML = `
    <div class="expert-header-bar">
      <button class="btn btn-sm" onclick="selectedExpert=null; render();">← Back</button>
      <span class="status-badge status-${hasOutput ? 'approved' : 'idle'}">${hasOutput ? 'has output' : 'not run'}</span>
    </div>
    <div class="expert-title"><h3>${data.role}</h3>
      <p class="gen-desc">Phase: ${data.phase_name} · Receives: ${data.receives.length ? data.receives.join(', ') : 'none (independent)'}</p>
    </div>
    <div class="expert-tabs">
      <button class="gen-tab active" onclick="showExpertTab(this,'expert-prompt')">Prompt</button>
      ${hasOutput ? '<button class="gen-tab" onclick="showExpertTab(this,\'expert-output\')">Output</button>' : ''}
    </div>
    <div id="expert-prompt" class="expert-content">
      <div class="prompt-edit-bar">
        <button class="btn btn-sm" id="btn-edit-prompt" onclick="togglePromptEdit()">Edit</button>
        <button class="btn btn-sm btn-primary" id="btn-save-prompt" onclick="savePrompt('${expertId}')" style="display:none">Save Changes</button>
        <button class="btn btn-sm" id="btn-cancel-prompt" onclick="cancelPromptEdit()" style="display:none">Cancel</button>
      </div>
      <div class="expert-prompt-text" id="prompt-view">${escapeHtml(data.prompt)}</div>
      <textarea class="expert-prompt-edit" id="prompt-editor" style="display:none">${escapeHtml(data.prompt)}</textarea>
    </div>
    ${hasOutput ? `<div id="expert-output" class="expert-content" style="display:none;"><div class="expert-output-text">${renderMarkdown(result.content)}</div></div>` : ''}`;
}

function togglePromptEdit() {
  document.getElementById('prompt-view').style.display = 'none';
  document.getElementById('prompt-editor').style.display = 'block';
  document.getElementById('btn-edit-prompt').style.display = 'none';
  document.getElementById('btn-save-prompt').style.display = '';
  document.getElementById('btn-cancel-prompt').style.display = '';
}

function cancelPromptEdit() {
  document.getElementById('prompt-view').style.display = '';
  document.getElementById('prompt-editor').style.display = 'none';
  document.getElementById('btn-edit-prompt').style.display = '';
  document.getElementById('btn-save-prompt').style.display = 'none';
  document.getElementById('btn-cancel-prompt').style.display = 'none';
}

async function savePrompt(expertId) {
  const content = document.getElementById('prompt-editor').value;
  const btn = document.getElementById('btn-save-prompt');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await fetch(`/api/council/expert/${expertId}/prompt`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    const data = await res.json();
    if (data.ok) { showToast('Prompt saved'); document.getElementById('prompt-view').textContent = content; cancelPromptEdit(); }
    else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Save Changes'; }
}

function showExpertTab(btn, tabId) {
  const c = document.getElementById('expert-detail-container');
  c.querySelectorAll('.expert-content').forEach(el => el.style.display = 'none');
  c.querySelectorAll('.gen-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).style.display = 'block';
}

// ── Council execution ───────────────────────────────────────

async function runCouncilPhase(phaseId) {
  const btn = document.getElementById(`btn-phase-${phaseId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  try {
    const res = await fetch('/api/council/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase_id: phaseId }) });
    const data = await res.json();
    if (!data.ok) { showToast(`Error: ${data.error}`); return; }
    currentJobId = data.job_id;
    consoleStatus = { text: 'Starting...', cls: 'running' };
    renderConsole();
    streamJobProgress(data.job_id);
  } catch (e) {
    showToast(`Error: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Run Phase'; }
  }
}

function streamJobProgress(jobId) {
  if (activeEvtSource) activeEvtSource.close();
  const evtSource = new EventSource(`/api/jobs/${jobId}/stream`);
  activeEvtSource = evtSource;

  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'log') {
      consolePush({ time: data.time, message: data.message, level: data.level || 'info', expert: data.expert });

      if (data.running_experts) runningExperts = new Set(data.running_experts);

      if (data.level === 'done' && data.expert) {
        fetchExpertResults().then(() => render());
      }
      if (data.level === 'start' && activeTab === 'progress') render();

      if (data.experts_total > 0) {
        consoleStatus = { text: `${data.phase_name||''} ${data.experts_done}/${data.experts_total}`, cls: 'running' };
        const s = document.getElementById('console-status');
        if (s) { s.textContent = consoleStatus.text; s.className = 'console-status running'; }
      }
    }
    if (data.type === 'done') {
      evtSource.close(); activeEvtSource = null; currentJobId = null; runningExperts.clear();
      consoleStatus = data.status === 'complete' ? { text: 'Complete', cls: 'done' } : { text: 'Error', cls: 'error' };
      const s = document.getElementById('console-status');
      if (s) { s.textContent = consoleStatus.text; s.className = `console-status ${consoleStatus.cls}`; }
      if (data.error) consolePush({ time: '', message: `Error: ${data.error}`, level: 'error' });
      fetchPipeline();
      showToast(data.status === 'complete' ? 'Phase complete' : `Error: ${data.error}`);
    }
  };
  evtSource.onerror = () => {
    evtSource.close(); activeEvtSource = null;
    consoleStatus = { text: 'Disconnected', cls: 'error' };
    const s = document.getElementById('console-status');
    if (s) { s.textContent = 'Disconnected'; s.className = 'console-status error'; }
  };
}

async function approvePhase(phaseId) {
  if (!pipelineData) return;
  const stage = pipelineData.stages.find(s => s.stage === 1);
  if (!stage) return;
  for (const a of stage.artifacts.filter(a => a.content?.phase === phaseId && a.approval === 'pending'))
    await fetch(`/api/artifacts/1/${a._filename}/approve`, { method: 'POST' });
  showToast(`${phaseId} approved`); await fetchPipeline();
}

// ── Worldbuilding / Production ──────────────────────────────

function renderWorldbuildingGenerate() {
  return `<div class="generate-panel">
    <div class="generate-tabs">
      <button class="gen-tab active" onclick="showGenSub(this,'gen-freeform')">Freeform</button>
      <button class="gen-tab" onclick="showGenSub(this,'gen-character')">Character</button>
      <button class="gen-tab" onclick="showGenSub(this,'gen-environment')">Environment</button>
    </div>
    <div id="gen-freeform" class="gen-sub">
      <div class="form-group"><label>Prompt</label><textarea id="ff-prompt" rows="3" placeholder="Describe what you want..."></textarea></div>
      <div class="form-row">
        <div class="form-group half"><label>Width</label><input id="ff-w" type="number" value="1024"></div>
        <div class="form-group half"><label>Height</label><input id="ff-h" type="number" value="1024"></div>
        <div class="form-group half"><label>Results</label><input id="ff-n" type="number" value="1" min="1" max="4"></div>
      </div>
      <div class="form-group"><label>Label</label><input id="ff-label" type="text" placeholder="Name this generation"></div>
      <button class="btn btn-primary" onclick="generateFreeform()" id="btn-ff">Generate</button>
    </div>
    <div id="gen-character" class="gen-sub" style="display:none;">
      <div class="form-group"><label>Name</label><input id="ch-name" type="text" placeholder="e.g. Kael"></div>
      <div class="form-group"><label>Description</label><textarea id="ch-desc" rows="3" placeholder="Young scientist..."></textarea></div>
      <div class="form-group"><label>Style</label><input id="ch-style" type="text" placeholder="grounded sci-fi"></div>
      <button class="btn btn-primary" onclick="generateCharacter()" id="btn-ch">Generate Character Sheet</button>
    </div>
    <div id="gen-environment" class="gen-sub" style="display:none;">
      <div class="form-group"><label>Name</label><input id="env-name" type="text" placeholder="e.g. Metanoia Hub"></div>
      <div class="form-group"><label>Description</label><textarea id="env-desc" rows="3" placeholder="A vast atrium..."></textarea></div>
      <div class="form-group"><label>Style</label><input id="env-style" type="text" placeholder="golden hour"></div>
      <button class="btn btn-primary" onclick="generateEnvironment()" id="btn-env">Generate Environment</button>
    </div>
  </div>`;
}

function renderProductionGenerate() {
  return `<div class="generate-panel">
    <div class="form-group"><label>Shot Description</label><textarea id="shot-desc" rows="3" placeholder="Wide establishing shot..."></textarea></div>
    <div class="form-group"><label>Style</label><input id="shot-style" type="text" placeholder="anamorphic, cinematic"></div>
    <div class="form-row">
      <div class="form-group half"><label>Width</label><input id="shot-w" type="number" value="1920"></div>
      <div class="form-group half"><label>Height</label><input id="shot-h" type="number" value="1080"></div>
    </div>
    <button class="btn btn-primary" onclick="generateShot()" id="btn-shot">Generate Shot</button>
  </div>`;
}

function showGenSub(btn, id) {
  btn.closest('.generate-panel').querySelectorAll('.gen-sub').forEach(el => el.style.display = 'none');
  btn.closest('.generate-tabs').querySelectorAll('.gen-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).style.display = 'block';
}

// ── Generation actions ──────────────────────────────────────

async function generateFreeform() {
  const btn = document.getElementById('btn-ff'); btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const body = { prompt: document.getElementById('ff-prompt').value, width: +document.getElementById('ff-w').value, height: +document.getElementById('ff-h').value, number_results: +document.getElementById('ff-n').value, stage: 2, artifact_type: 'concept', label: document.getElementById('ff-label').value };
    const res = await fetch('/api/generate/image', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) { showToast(`Generated ${data.images.length} image(s)`); activeTab='artifacts'; await fetchPipeline(); }
    else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate'; }
}

async function generateCharacter() {
  const btn = document.getElementById('btn-ch'); btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/character', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: document.getElementById('ch-name').value, description: document.getElementById('ch-desc').value, style_prompt: document.getElementById('ch-style').value }) });
    const data = await res.json();
    if (data.ok) { showToast('Character generated'); activeTab='artifacts'; await fetchPipeline(); } else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate Character Sheet'; }
}

async function generateEnvironment() {
  const btn = document.getElementById('btn-env'); btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/environment', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: document.getElementById('env-name').value, description: document.getElementById('env-desc').value, style_prompt: document.getElementById('env-style').value }) });
    const data = await res.json();
    if (data.ok) { showToast('Environment generated'); activeTab='artifacts'; await fetchPipeline(); } else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate Environment'; }
}

async function generateShot() {
  const btn = document.getElementById('btn-shot'); btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/shot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ description: document.getElementById('shot-desc').value, style_prompt: document.getElementById('shot-style').value, width: +document.getElementById('shot-w').value, height: +document.getElementById('shot-h').value }) });
    const data = await res.json();
    if (data.ok) { showToast('Shot generated'); activeTab='artifacts'; await fetchPipeline(); } else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate Shot'; }
}

// ── Artifact actions ────────────────────────────────────────

async function updateArtifact(stage, fn, action) {
  const res = await fetch(`/api/artifacts/${stage}/${fn}/${action}`, { method:'POST' });
  const data = await res.json();
  if (data.ok) { showToast({approve:'Approved',reject:'Rejected',revision:'Revision requested'}[action]); await fetchPipeline(); }
}

async function deleteArtifact(stage, fn) {
  if (!confirm('Delete?')) return;
  await fetch(`/api/artifacts/${stage}/${fn}`, { method:'DELETE' });
  showToast('Deleted'); await fetchPipeline();
}

// ── Utilities ───────────────────────────────────────────────

function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderMarkdown(text) {
  let h = escapeHtml(text);
  h = h.replace(/^### (.+)$/gm, '<h5>$1</h5>');
  h = h.replace(/^## (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^- (.+)$/gm, '• $1');
  h = h.replace(/\n/g, '<br>');
  return h;
}

function formatConfig(c) { return JSON.stringify(c,null,2).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function openLightbox(url) { document.getElementById('lightbox-img').src = url; document.getElementById('lightbox').classList.add('visible'); }
function closeLightbox() { document.getElementById('lightbox').classList.remove('visible'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

function updateDeadlineCountdown() {
  const days = Math.floor((new Date('2026-08-14T23:59:59') - new Date()) / 86400000);
  const el = document.getElementById('countdown');
  if (el) el.textContent = `${days} days remaining`;
}

document.addEventListener('DOMContentLoaded', () => {
  fetchPipeline();
  updateDeadlineCountdown();
  setInterval(updateDeadlineCountdown, 60000);
  document.getElementById('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.getElementById('expert-modal').addEventListener('click', e => { if (e.target.id === 'expert-modal') closeExpertModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); closeExpertModal(); } });
});
