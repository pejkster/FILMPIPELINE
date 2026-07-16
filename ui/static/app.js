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
let expertRegistry = null;
let draggedExpert = null;

function getCouncilPhases(stage) {
  const cd = councilData[stage];
  return cd ? cd.phases : [];
}

function currentStageHasCouncil() {
  return selectedStage && councilData[selectedStage] && councilData[selectedStage].phases;
}

function findPhaseAcrossStages(phaseId) {
  for (const s of Object.keys(councilData)) {
    const phase = councilData[s].phases.find(p => p.id === phaseId);
    if (phase) return { phase, stage: parseInt(s) };
  }
  return null;
}

const consoleLogs = [];
let consoleStatus = null;

async function fetchPipeline() {
  const res = await fetch('/api/pipeline');
  pipelineData = await res.json();
  // Load council data for stages that have phases
  councilData = {};
  for (const s of pipelineData.stages) {
    if (s.config && s.config.phases) {
      const cRes = await fetch(`/api/council/phases?stage=${s.stage}`);
      const cData = await cRes.json();
      councilData[s.stage] = cData;
    }
  }
  await fetchExpertResults();
  await fetchSynthesis();
  await fetchExpertRegistry();
  render();
}

async function fetchExpertResults() {
  try {
    expertResults = {};
    for (const s of [1, 2]) {
      const res = await fetch(`/api/council/results?stage=${s}`);
      const data = await res.json();
      for (const r of data.results) expertResults[r.expert_id] = r;
    }
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
  renderExpertSidebar();
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
    { id: 'generate', label: currentStageHasCouncil() ? 'Council' : 'Generate' },
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
  if (currentStageHasCouncil()) return renderCouncilPanel();
  if (stage.stage === 3) return renderProductionGenerate();
  return '<div class="empty-state"><p>No generation panel for this stage.</p></div>';
}

function renderCouncilPanel() {
  if (!currentStageHasCouncil()) return '<div class="generate-panel"><p>No council phases configured for this stage.</p></div>';
  if (selectedExpert) return renderExpertDetail();

  const phases = getCouncilPhases(selectedStage);
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
        <div class="phase-mode-bar">
          <span class="phase-mode-label">Mode:</span>
          <button class="phase-mode-btn ${phase.mode === 'parallel' ? 'active' : ''}" onclick="event.stopPropagation(); setPhaseMode('${phase.id}', 'parallel')">Parallel</button>
          <button class="phase-mode-btn ${phase.mode === 'sequential' ? 'active' : ''}" onclick="event.stopPropagation(); setPhaseMode('${phase.id}', 'sequential')">Sequential</button>
          <span class="phase-mode-desc">${phase.mode === 'parallel' ? 'Experts run independently, previous phase context only' : 'Experts chain within phase + previous phase context'}</span>
        </div>
        <div class="phase-mode-bar">
          <span class="phase-mode-label">Context:</span>
          <select class="context-level-select" onchange="event.stopPropagation(); setContextLevel('${phase.id}', this.value)">
            ${['none','basic','futurax','disordine'].map(l => `<option value="${l}" ${phase.context_level === l ? 'selected' : ''}>${l === 'none' ? 'None' : l === 'futurax' ? 'FuturaX' : l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('')}
          </select>
          <button class="btn-icon" onclick="event.stopPropagation(); previewContext('${phase.context_level || 'none'}')" title="Preview context preamble">👁</button>
        </div>
        <div class="phase-experts-drop" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="dropToPhase(event, '${phase.id}', this)">
          ${phase.experts.map(e => {
            const done = !!expertResults[e.id];
            const running = runningExperts.has(e.id);
            const cls = running ? 'running' : done ? 'has-result' : '';
            return `<span class="expert-chip clickable ${cls}" onclick="event.stopPropagation(); loadExpert('${e.id}')">
              ${e.role}
              <button class="expert-chip-remove" onclick="event.stopPropagation(); removeExpertFromPhase('${phase.id}', '${e.id}')" title="Remove from phase">×</button>
            </span>`;
          }).join('')}
          ${phase.experts.length === 0 ? '<span class="registry-empty">Drag experts here from the sidebar</span>' : ''}
        </div>
        <div class="phase-actions">
          <button class="btn btn-primary" onclick="event.stopPropagation(); runCouncilPhase('${phase.id}')" id="btn-phase-${phase.id}">${phase.status === 'idle' ? 'Run Phase' : 'Re-run'}</button>
          ${currentJobId ? `<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); stopGeneration()">Stop</button>` : ''}
          ${phase.status === 'pending' && phase.checkpoint ? `<button class="btn btn-approve btn-sm" onclick="event.stopPropagation(); approvePhase('${phase.id}')">Approve</button>` : ''}
        </div>
      </div>`;
    if (i < phases.length - 1) html += `<div class="council-connector ${phase.status === 'approved' ? 'passed' : ''}">${phase.status === 'approved' ? '↓' : '⋮'}</div>`;
  });
  return html + '</div>';
}

// ── Progress tab ────────────────────────────────────────────

const collapsedPhases = new Set();

function renderProgressPanel(stage) {
  if (!currentStageHasCouncil()) return '<div class="empty-state"><p>No council phases for this stage.</p></div>';

  const phases = getCouncilPhases(selectedStage);
  const totalExperts = phases.reduce((s, p) => s + p.experts.length, 0);
  const doneExperts = Object.keys(expertResults).length;

  let html = '<div class="progress-panel">';

  html += `<div class="progress-top-bar">
    <span class="progress-overall">${doneExperts}/${totalExperts} experts complete</span>
    <div class="progress-top-actions">
      ${doneExperts > 0 ? `<button class="btn btn-sm btn-danger-outline" onclick="clearAllResults()">Clear All</button>` : ''}
    </div>
  </div>`;

  getCouncilPhases(selectedStage).forEach(phase => {
    const phaseDone = phase.experts.filter(e => !!expertResults[e.id]).length;
    const collapsed = collapsedPhases.has(phase.id);
    const chevron = collapsed ? '▸' : '▾';

    html += `<div class="progress-phase ${collapsed ? 'collapsed' : ''}">
      <div class="progress-phase-header" onclick="togglePhaseCollapse('${phase.id}')">
        <div class="progress-phase-left">
          <span class="phase-chevron">${chevron}</span>
          <h4>${phase.name}</h4>
          <span class="progress-count">${phaseDone}/${phase.experts.length}</span>
        </div>
        <div class="progress-phase-actions" onclick="event.stopPropagation()">
          ${phaseDone > 0 ? `<button class="btn btn-sm btn-danger-outline" onclick="clearPhaseResults('${phase.id}')" title="Clear phase results">Clear</button>` : ''}
        </div>
      </div>`;

    if (!collapsed) {
      html += '<div class="progress-experts">';
      phase.experts.forEach(e => {
        const result = expertResults[e.id];
        const isRunning = runningExperts.has(e.id);

        if (result) {
          const hasSummary = !!result.summary;
          const summaryHtml = hasSummary
            ? `<div class="progress-summary-llm" onclick="openExpertModal('${e.id}')">${renderMarkdown(result.summary)}</div>`
            : `<div class="progress-summary-actions"><button class="btn btn-sm" onclick="event.stopPropagation(); summarizeExpert('${e.id}')">Generate Summary</button></div>`;
          html += `
            <div class="progress-expert done">
              <div class="progress-expert-header">
                <span class="progress-expert-name" onclick="openExpertModal('${e.id}')">${e.role}</span>
                <div class="progress-expert-actions">
                  <span class="progress-expert-meta">${result.content.length} chars</span>
                  <button class="btn-icon" onclick="rerunExpert('${e.id}')" title="Rerun">↻</button>
                  <button class="btn-icon btn-icon-danger" onclick="deleteExpertResult('${e.id}')" title="Delete">✕</button>
                </div>
              </div>
              ${summaryHtml}
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
                <div class="progress-expert-actions">
                  <span class="progress-expert-meta">queued</span>
                  <button class="btn-icon" onclick="rerunExpert('${e.id}')" title="Run this expert">▶</button>
                </div>
              </div>
            </div>`;
        }
      });
      html += '</div>';
    }
    html += '</div>';
  });
  return html + '</div>';
}

function togglePhaseCollapse(phaseId) {
  if (collapsedPhases.has(phaseId)) collapsedPhases.delete(phaseId);
  else collapsedPhases.add(phaseId);
  render();
}

async function clearPhaseResults(phaseId) {
  if (!confirm(`Clear all results for this phase?`)) return;
  await fetch(`/api/council/results/clear/${phaseId}`, { method: 'POST' });
  showToast('Phase results cleared');
  await fetchPipeline();
}

async function deleteExpertResult(expertId) {
  await fetch(`/api/council/results/${expertId}`, { method: 'DELETE' });
  showToast('Expert result deleted');
  await fetchPipeline();
}

async function summarizeExpert(expertId) {
  showToast('Generating summary...');
  try {
    const res = await fetch(`/api/council/expert/${expertId}/summarize`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('Summary generated');
      await fetchExpertResults();
      render();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
}

async function rerunExpert(expertId, customPrompt = null) {
  showToast('Rerunning expert...');
  try {
    const body = customPrompt ? { custom_prompt: customPrompt } : {};
    const res = await fetch(`/api/council/expert/${expertId}/rerun`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Expert rerun complete');
      await fetchExpertResults();
      render();
      if (document.getElementById('expert-modal').classList.contains('visible')) {
        openExpertModal(expertId);
      }
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
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
      if (text.length > 200) text = text.substring(0, 197) + '...';
      items.push(`<li><strong>${escapeHtml(currentHeader)}:</strong> ${escapeHtml(text)}</li>`);
      currentHeader = null;
    }
  }

  if (items.length === 0) {
    const meaningful = lines.filter(l => l.trim().length > 20).slice(0, 4);
    return meaningful.map(l => { let t = l.trim(); if (t.length > 200) t = t.substring(0, 197) + '...'; return `<li>${escapeHtml(t)}</li>`; }).join('');
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

  let chatHistory = [];
  try { const res = await fetch(`/api/council/expert/${expertId}/chat`); const d = await res.json(); chatHistory = d.history || []; } catch(e) {}

  const summary = generateSmartSummary(result.content);
  const modal = document.getElementById('expert-modal');
  const body = document.getElementById('expert-modal-body');

  const chatHtml = chatHistory.map(c => `
    <div class="chat-msg chat-user"><div class="chat-bubble">${escapeHtml(c.user)}</div><span class="chat-time">${new Date(c.timestamp).toLocaleTimeString()}</span></div>
    <div class="chat-msg chat-assistant"><div class="chat-bubble">${renderMarkdown(c.assistant)}</div></div>
  `).join('');

  body.innerHTML = `
    <div class="modal-main">
      <div class="modal-header-bar">
        <div>
          <h2 class="modal-title">${result.role}</h2>
          <p class="modal-subtitle">Phase: ${meta.phase_name || result.phase_id} · ${result.content.length} chars · ${new Date(result.timestamp).toLocaleString()}</p>
        </div>
        <div class="modal-header-actions">
          <button class="btn btn-sm" onclick="rerunExpertFromModal('${expertId}')" title="Rerun with current prompt">↻ Rerun</button>
          <button class="btn btn-sm" onclick="closeExpertModal()">Close</button>
        </div>
      </div>
      <div class="modal-tabs">
        <button class="gen-tab active" onclick="showModalTab(this, 'modal-summary')">Summary</button>
        <button class="gen-tab" onclick="showModalTab(this, 'modal-full')">Full Output</button>
        <button class="gen-tab" onclick="showModalTab(this, 'modal-rerun')">Rerun with Prompt</button>
        <button class="gen-tab" onclick="showModalTab(this, 'modal-feedback-loop')">Multi-Model Debate</button>
      </div>
      <div id="modal-summary" class="modal-content-area">
        ${result.summary
          ? `<div class="modal-summary-card"><div class="modal-summary-llm">${renderMarkdown(result.summary)}</div></div>`
          : `<div class="modal-summary-card">
              <div class="modal-summary-list">${summary}</div>
              <div style="margin-top:1rem;"><button class="btn btn-primary btn-sm" onclick="summarizeExpertInModal('${expertId}')">Generate LLM Summary</button></div>
            </div>`
        }
      </div>
      <div id="modal-full" class="modal-content-area" style="display:none;">
        <div class="modal-full-output">${renderMarkdown(result.content)}</div>
      </div>
      <div id="modal-rerun" class="modal-content-area" style="display:none;">
        <div class="rerun-container">
          <p class="rerun-desc">Write a custom prompt to rerun this expert with different instructions. Leave empty to rerun with the original prompt.</p>
          <textarea id="rerun-prompt-${expertId}" class="rerun-prompt" rows="8" placeholder="Custom system prompt (optional)...">${escapeHtml(meta.prompt || '')}</textarea>
          <div class="rerun-actions">
            <button class="btn btn-primary" onclick="rerunExpertCustom('${expertId}')" id="btn-rerun-${expertId}">Rerun Expert</button>
          </div>
        </div>
      </div>
      <div id="modal-feedback-loop" class="modal-content-area" style="display:none;">
        <div class="feedback-loop-container" id="fl-container-${expertId}">
          <div class="fl-header">
            <div class="fl-description">
              <h4>Multi-Model Debate</h4>
              <p>Run this expert's output through 6 different LLMs via OpenRouter. Each model produces its own statement, then they blind-review each other's work, score it (1-5), and revise iteratively until consensus or max rounds.</p>
              <p class="fl-models-list">Models: Claude Opus 4.8, GPT-4.1, Gemini 2.5 Pro, Grok 3, Qwen 3 235B, DeepSeek R1</p>
            </div>
            <div class="fl-controls">
              <label>Max rounds:</label>
              <select id="fl-rounds-${expertId}">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3" selected>3</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </select>
              <button class="btn btn-primary" id="fl-start-${expertId}" onclick="startFeedbackLoop('${expertId}')">Start Debate</button>
            </div>
          </div>
          <div class="fl-monitor" id="fl-monitor-${expertId}" style="display:none;">
            <div class="fl-monitor-header">
              <span class="fl-status" id="fl-status-${expertId}">Running...</span>
            </div>
            <div class="fl-log" id="fl-log-${expertId}"></div>
          </div>
          <div class="fl-results" id="fl-results-${expertId}"></div>
        </div>
      </div>
    </div>
    <div class="modal-chat-side">
      <div class="modal-chat-side-header">Chat with ${escapeHtml(result.role)}</div>
      <div class="chat-messages" id="chat-messages-${expertId}">
        ${chatHtml || '<div class="chat-empty">Ask questions, request clarifications, or add context.</div>'}
      </div>
      <div class="chat-input-bar">
        <textarea id="chat-input-${expertId}" class="chat-input" rows="2" placeholder="Ask a question..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendExpertChat('${expertId}')}"></textarea>
        <button class="btn btn-primary btn-sm" onclick="sendExpertChat('${expertId}')" id="btn-chat-${expertId}">Send</button>
      </div>
    </div>`;

  modal.classList.add('visible');
  modal.dataset.expertId = expertId;
  initFeedbackLoopTab(expertId);
}

async function sendExpertChat(expertId) {
  const input = document.getElementById(`chat-input-${expertId}`);
  const btn = document.getElementById(`btn-chat-${expertId}`);
  const msg = input.value.trim();
  if (!msg) return;

  btn.disabled = true; btn.textContent = 'Sending...';
  const messagesEl = document.getElementById(`chat-messages-${expertId}`);
  const emptyEl = messagesEl.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();

  messagesEl.innerHTML += `<div class="chat-msg chat-user"><div class="chat-bubble">${escapeHtml(msg)}</div></div>
    <div class="chat-msg chat-assistant chat-loading"><div class="chat-bubble">Thinking...</div></div>`;
  messagesEl.scrollTop = messagesEl.scrollHeight;
  input.value = '';

  try {
    const res = await fetch(`/api/council/expert/${expertId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    const loadingEl = messagesEl.querySelector('.chat-loading');
    if (loadingEl) loadingEl.remove();

    if (data.ok) {
      messagesEl.innerHTML += `<div class="chat-msg chat-assistant"><div class="chat-bubble">${renderMarkdown(data.response)}</div></div>`;
    } else {
      messagesEl.innerHTML += `<div class="chat-msg chat-error"><div class="chat-bubble">Error: ${escapeHtml(data.error)}</div></div>`;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (e) {
    const loadingEl = messagesEl.querySelector('.chat-loading');
    if (loadingEl) loadingEl.remove();
    messagesEl.innerHTML += `<div class="chat-msg chat-error"><div class="chat-bubble">Error: ${escapeHtml(e.message)}</div></div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Send';
  }
}

async function summarizeExpertInModal(expertId) {
  showToast('Generating summary...');
  await summarizeExpert(expertId);
  openExpertModal(expertId);
}

async function rerunExpertFromModal(expertId) {
  showToast('Rerunning expert...');
  await rerunExpert(expertId);
}

async function rerunExpertCustom(expertId) {
  const textarea = document.getElementById(`rerun-prompt-${expertId}`);
  const btn = document.getElementById(`btn-rerun-${expertId}`);
  const customPrompt = textarea.value.trim() || null;

  btn.disabled = true; btn.textContent = 'Running...';
  try {
    await rerunExpert(expertId, customPrompt);
  } finally {
    btn.disabled = false; btn.textContent = 'Rerun Expert';
  }
}

function closeExpertModal() { document.getElementById('expert-modal').classList.remove('visible'); }

function showModalTab(btn, tabId) {
  const main = document.querySelector('.modal-main');
  main.querySelectorAll('.modal-content-area').forEach(el => el.style.display = 'none');
  main.querySelectorAll('.gen-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).style.display = 'block';
}

// ── Feedback Loop (Multi-Model Debate) ─────────────────────

async function startFeedbackLoop(expertId) {
  const roundsEl = document.getElementById(`fl-rounds-${expertId}`);
  const startBtn = document.getElementById(`fl-start-${expertId}`);
  const monitorEl = document.getElementById(`fl-monitor-${expertId}`);
  const logEl = document.getElementById(`fl-log-${expertId}`);
  const statusEl = document.getElementById(`fl-status-${expertId}`);
  const resultsEl = document.getElementById(`fl-results-${expertId}`);

  const maxRounds = parseInt(roundsEl.value);
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  monitorEl.style.display = '';
  logEl.innerHTML = '';
  resultsEl.innerHTML = '';
  statusEl.textContent = 'Starting...';
  statusEl.className = 'fl-status fl-running';

  try {
    const res = await fetch(`/api/council/expert/${expertId}/feedback-loop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_rounds: maxRounds })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(`Error: ${data.error}`);
      startBtn.disabled = false; startBtn.textContent = 'Start Debate';
      return;
    }

    // Stream events
    const evtSource = new EventSource(`/api/feedback-loops/${data.loop_id}/stream`);
    evtSource.onmessage = (event) => {
      const evt = JSON.parse(event.data);
      if (evt.type === 'log') {
        const icons = { phase: '▶ ', start: '  ◦ ', done: '  ● ', error: '  ✕ ', info: '  ' };
        const line = document.createElement('div');
        line.className = `fl-log-line fl-${evt.level || 'info'}`;
        line.innerHTML = `<span class="fl-log-time">${evt.time}</span>${icons[evt.level] || '  '}${escapeHtml(evt.message)}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        statusEl.textContent = evt.message;
      }
      if (evt.type === 'done') {
        evtSource.close();
        statusEl.textContent = evt.status === 'complete' ? 'Complete' : `Error: ${evt.error || 'Unknown'}`;
        statusEl.className = `fl-status ${evt.status === 'complete' ? 'fl-complete' : 'fl-error'}`;
        startBtn.disabled = false; startBtn.textContent = 'Re-run Debate';
        if (evt.status === 'complete') loadFeedbackLoopResults(expertId);
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
      statusEl.textContent = 'Connection lost';
      statusEl.className = 'fl-status fl-error';
      startBtn.disabled = false; startBtn.textContent = 'Start Debate';
    };
  } catch (e) {
    showToast(`Error: ${e.message}`);
    startBtn.disabled = false; startBtn.textContent = 'Start Debate';
  }
}

async function loadFeedbackLoopResults(expertId) {
  const resultsEl = document.getElementById(`fl-results-${expertId}`);
  if (!resultsEl) return;

  try {
    const res = await fetch(`/api/council/expert/${expertId}/feedback-loop`);
    const data = await res.json();
    if (!data.result) { resultsEl.innerHTML = ''; return; }

    const r = data.result;
    let html = '';

    // Analysis summary
    if (r.analysis) {
      html += `<div class="fl-analysis">
        <h4>Analysis</h4>
        <p class="fl-analysis-summary">${escapeHtml(r.analysis.summary || '')}</p>`;

      if (r.analysis.consensus_points && r.analysis.consensus_points.length) {
        html += '<div class="fl-section"><h5>Consensus Points</h5><ul>';
        r.analysis.consensus_points.forEach(p => { html += `<li>${escapeHtml(p)}</li>`; });
        html += '</ul></div>';
      }

      if (r.analysis.strongest_ideas && r.analysis.strongest_ideas.length) {
        html += '<div class="fl-section"><h5>Strongest Ideas</h5><ul>';
        r.analysis.strongest_ideas.forEach(p => { html += `<li>${escapeHtml(p)}</li>`; });
        html += '</ul></div>';
      }

      if (r.analysis.similarities && r.analysis.similarities.length) {
        html += '<div class="fl-section"><h5>Similarities</h5>';
        r.analysis.similarities.forEach(s => {
          html += `<div class="fl-finding"><span class="fl-finding-theme">${escapeHtml(s.theme)}</span> ${escapeHtml(s.detail)}</div>`;
        });
        html += '</div>';
      }
      if (r.analysis.differences && r.analysis.differences.length) {
        html += '<div class="fl-section"><h5>Differences</h5>';
        r.analysis.differences.forEach(d => {
          html += `<div class="fl-finding"><span class="fl-finding-theme">${escapeHtml(d.theme)}</span> ${escapeHtml(d.detail)}</div>`;
        });
        html += '</div>';
      }
      html += '</div>';
    }

    // Final statements per model
    const lastRound = r.rounds[r.rounds.length - 1];
    if (lastRound && lastRound.statements) {
      html += '<div class="fl-statements"><h4>Final Statements (Round ' + lastRound.round + ')</h4>';
      for (const [mid, s] of Object.entries(lastRound.statements)) {
        html += `<div class="fl-statement-card">
          <div class="fl-statement-model">${escapeHtml(s.name)}</div>
          <div class="fl-statement-text">${renderMarkdown(s.text)}</div>
        </div>`;
      }
      html += '</div>';
    }

    // Round-by-round feedback details (collapsible)
    if (r.rounds.length > 1) {
      html += '<div class="fl-rounds-detail"><h4>Round-by-Round Detail</h4>';
      r.rounds.forEach((round, i) => {
        if (!round.feedback || Object.keys(round.feedback).length === 0) return;
        html += `<details class="fl-round-detail"><summary>Round ${round.round} Feedback</summary>`;
        for (const [mid, feedbacks] of Object.entries(round.feedback)) {
          if (!feedbacks.length) continue;
          const avgScore = (feedbacks.reduce((s, f) => s + f.score, 0) / feedbacks.length).toFixed(1);
          html += `<div class="fl-feedback-group">
            <div class="fl-feedback-target">Feedback for: ${escapeHtml(lastRound.statements[mid]?.name || mid)} (avg: ${avgScore}/5)</div>`;
          feedbacks.forEach(fb => {
            html += `<div class="fl-feedback-item">
              <span class="fl-score fl-score-${fb.score}">${fb.score}/5</span>
              <span class="fl-reviewer">${escapeHtml(fb.reviewer)}</span>
              <span class="fl-feedback-text">${escapeHtml(fb.feedback)}</span>
            </div>`;
          });
          html += '</div>';
        }

        // Revisions
        if (round.revisions && Object.keys(round.revisions).length) {
          html += '<div class="fl-revisions">';
          for (const [mid, rev] of Object.entries(round.revisions)) {
            const labels = ['Unchanged', 'Minor', 'Major'];
            const cls = ['unchanged', 'minor', 'major'];
            const score = rev.revision_score || 0;
            html += `<div class="fl-revision-item">
              <span class="fl-revision-badge fl-rev-${cls[score]}">${labels[score]}</span>
              <span class="fl-revision-model">${escapeHtml(lastRound.statements[mid]?.name || mid)}</span>
              ${rev.rationale ? `<span class="fl-revision-rationale">${escapeHtml(rev.rationale)}</span>` : ''}
            </div>`;
          }
          html += '</div>';
        }
        html += '</details>';
      });
      html += '</div>';
    }

    resultsEl.innerHTML = html;

    // Also show the monitor if there are results but no active stream
    const monitorEl = document.getElementById(`fl-monitor-${expertId}`);
    if (monitorEl) monitorEl.style.display = '';

  } catch (e) { console.error('Failed to load feedback loop results:', e); }
}

// Load existing feedback loop results when modal opens
async function initFeedbackLoopTab(expertId) {
  const resultsEl = document.getElementById(`fl-results-${expertId}`);
  if (!resultsEl) return;
  try {
    const res = await fetch(`/api/council/expert/${expertId}/feedback-loop`);
    const data = await res.json();
    if (data.result) {
      loadFeedbackLoopResults(expertId);
      const statusEl = document.getElementById(`fl-status-${expertId}`);
      const monitorEl = document.getElementById(`fl-monitor-${expertId}`);
      if (statusEl) { statusEl.textContent = 'Previous run available'; statusEl.className = 'fl-status fl-complete'; }
      if (monitorEl) monitorEl.style.display = '';
      const startBtn = document.getElementById(`fl-start-${expertId}`);
      if (startBtn) startBtn.textContent = 'Re-run Debate';
    }
  } catch (e) {}
}

function generateSmartSummary(content) {
  const lines = content.split('\n');
  const sections = [];
  let cur = null;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('## ')) {
      if (cur) sections.push(cur);
      cur = { title: t.replace(/^#+\s*/, ''), point: null };
    } else if (cur && !cur.point) {
      const cleaned = t.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '');
      if (cleaned.length > 25) {
        cur.point = cleaned.length > 250 ? cleaned.substring(0, 247) + '...' : cleaned;
      }
    }
  }
  if (cur) sections.push(cur);

  if (sections.length === 0) {
    const meaningful = lines.filter(l => l.trim().length > 20).slice(0, 5);
    return meaningful.map(l => {
      let t = l.trim();
      if (t.length > 250) t = t.substring(0, 247) + '...';
      return `<div class="summary-item">${escapeHtml(t)}</div>`;
    }).join('');
  }

  let html = '';
  for (const s of sections.slice(0, 8)) {
    html += `<div class="summary-section">
      <div class="summary-section-title">${escapeHtml(s.title)}</div>
      ${s.point ? `<p class="summary-point">${escapeHtml(s.point)}</p>` : ''}
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
    getCouncilPhases(selectedStage).forEach(phase => {
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

async function setPhaseMode(phaseId, mode) {
  try {
    const stg = selectedStage || 1;
    const res = await fetch(`/api/council/phase/${phaseId}/mode?stage=${stg}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`${phaseId} set to ${mode}`);
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
}

async function setContextLevel(phaseId, level) {
  try {
    const stg = selectedStage || 1;
    const res = await fetch(`/api/council/phase/${phaseId}/context-level?stage=${stg}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context_level: level })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`${phaseId} context → ${level}`);
      await fetchPipeline();
    } else showToast(`Error: ${data.error}`);
  } catch (e) { showToast(`Error: ${e.message}`); }
}

async function previewContext(level) {
  if (level === 'none') { showToast('No preamble for "none" context'); return; }
  try {
    const res = await fetch(`/api/council/context/${level}`);
    const data = await res.json();
    const modal = document.createElement('div');
    modal.className = 'expert-modal-overlay';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `<div class="expert-modal" style="max-width:700px">
      <div class="modal-header"><h3>Context: ${level}</h3><button class="modal-close" onclick="this.closest('.expert-modal-overlay').remove()">×</button></div>
      <div class="modal-body">
        <textarea id="context-edit-area" style="width:100%;min-height:400px;font-family:monospace;font-size:13px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:12px">${data.content.replace(/</g,'&lt;')}</textarea>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-sm" onclick="this.closest('.expert-modal-overlay').remove()">Cancel</button>
          <button class="btn btn-sm btn-primary" onclick="saveContext('${level}', document.getElementById('context-edit-area').value, this)">Save</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal);
  } catch (e) { showToast(`Error: ${e.message}`); }
}

async function fetchExpertRegistry() {
  try {
    const res = await fetch('/api/council/experts/registry');
    const data = await res.json();
    expertRegistry = data.experts;
  } catch (e) {}
}

function renderExpertSidebar() {
  const listEl = document.getElementById('expert-sidebar-list');
  const countEl = document.getElementById('expert-sidebar-count');
  if (!listEl || !expertRegistry) return;

  countEl.innerHTML = `${expertRegistry.length} <button class="btn-add-expert" onclick="openCreateExpertModal()" title="Create new expert">+</button>`;

  listEl.innerHTML = expertRegistry.map(e => {
    const phases = e.assigned_phases || [];
    const tagsHtml = phases.map(pid => `<span class="expert-phase-tag">${pid}</span>`).join('');
    return `<div class="expert-sidebar-item" draggable="true"
      ondragstart="startDrag(event, '${e.id}', '${escapeAttr(e.role)}', '${e.prompt_file}')"
      onclick="openExpertPromptEditor('${e.id}', '${escapeAttr(e.role)}', '${e.prompt_file}')">
      <span class="expert-drag-handle">⠿</span>
      <span class="expert-name">${e.role}</span>
      <span class="expert-phase-tags">${tagsHtml}</span>
    </div>`;
  }).join('');
}

function escapeAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function openExpertPromptEditor(expertId, role, promptFile) {
  // Fetch and show prompt in a modal for viewing/editing
  fetch(`/api/council/expert/${expertId}`)
    .then(r => r.json())
    .then(data => {
      const modal = document.createElement('div');
      modal.className = 'expert-modal-overlay';
      modal.onclick = ev => { if (ev.target === modal) modal.remove(); };
      const prompt = data.prompt || '';
      modal.innerHTML = `<div class="expert-modal" style="max-width:750px">
        <div class="modal-header">
          <h3>${role}</h3>
          <button class="modal-close" onclick="this.closest('.expert-modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:8px">${promptFile}</div>
          <textarea id="expert-prompt-edit" style="width:100%;min-height:450px;font-family:monospace;font-size:13px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:12px;resize:vertical">${prompt.replace(/</g,'&lt;')}</textarea>
          <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
            <div style="display:flex;gap:6px;align-items:center">
              <span style="font-size:0.7rem;color:var(--text-muted)">Add to phase:</span>
              ${councilData ? Object.entries(councilData).flatMap(([s, cd]) =>
                cd.phases.map(p =>
                  `<button class="btn btn-sm" onclick="addExpertToPhase('${p.id}','${expertId}','${escapeAttr(role)}','${promptFile}'); this.textContent='✓'; this.disabled=true">${p.name}</button>`
                )
              ).join('') : ''}
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm" onclick="this.closest('.expert-modal-overlay').remove()">Cancel</button>
              <button class="btn btn-sm btn-primary" onclick="saveExpertPrompt('${expertId}', document.getElementById('expert-prompt-edit').value, this)">Save Prompt</button>
            </div>
          </div>
        </div>
      </div>`;
      document.body.appendChild(modal);
    })
    .catch(e => showToast(`Error: ${e.message}`));
}

async function saveExpertPrompt(expertId, content, btn) {
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await fetch(`/api/council/expert/${expertId}/prompt`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.ok) { showToast('Prompt saved'); btn.textContent = 'Saved'; }
    else showToast(`Error: ${data.error}`);
  } catch (e) { showToast(`Error: ${e.message}`); btn.disabled = false; btn.textContent = 'Save Prompt'; }
}

function openCreateExpertModal() {
  const modal = document.createElement('div');
  modal.className = 'expert-modal-overlay';
  modal.onclick = ev => { if (ev.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="expert-modal" style="max-width:600px">
    <div class="modal-header">
      <h3>Create New Expert</h3>
      <button class="modal-close" onclick="this.closest('.expert-modal-overlay').remove()">×</button>
    </div>
    <div class="modal-body">
      <div class="create-expert-form">
        <label>Name / Title</label>
        <input type="text" id="new-expert-name" placeholder="e.g. Sound Designer, Political Theorist, Marine Biologist" style="width:100%;padding:8px;background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
        <label>Description — who are they, what do they know?</label>
        <textarea id="new-expert-desc" rows="4" placeholder="Describe their expertise, background, and unique perspective. What domains do they cover? What methodologies or traditions do they draw from?" style="width:100%;padding:8px;background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.85rem;resize:vertical"></textarea>
        <label>Goals — what should they produce?</label>
        <textarea id="new-expert-goals" rows="3" placeholder="What specific deliverable should this expert create? What questions should they address? What format should the output take?" style="width:100%;padding:8px;background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.85rem;resize:vertical"></textarea>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm" onclick="this.closest('.expert-modal-overlay').remove()">Cancel</button>
        <button class="btn btn-sm btn-primary" id="create-expert-btn" onclick="createExpert(this)">Create Expert</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('new-expert-name').focus();
}

async function createExpert(btn) {
  const name = document.getElementById('new-expert-name').value.trim();
  const description = document.getElementById('new-expert-desc').value.trim();
  const goals = document.getElementById('new-expert-goals').value.trim();

  if (!name) { showToast('Name is required'); return; }
  if (!description) { showToast('Description is required'); return; }

  btn.disabled = true;
  btn.textContent = 'Generating prompt...';

  try {
    const res = await fetch('/api/council/experts/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, goals: goals || description })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Created: ${data.expert.role}`);
      btn.closest('.expert-modal-overlay').remove();
      await fetchExpertRegistry();
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
      btn.disabled = false;
      btn.textContent = 'Create Expert';
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
    btn.disabled = false;
    btn.textContent = 'Create Expert';
  }
}

async function addExpertToPhase(phaseId, expertId, role, promptFile) {
  const found = findPhaseAcrossStages(phaseId);
  const phase = found ? found.phase : null;
  if (!phase) return;
  if (phase.experts.some(e => e.id === expertId)) {
    showToast('Already in this phase');
    return;
  }
  const newExperts = [...phase.experts, { id: expertId, role, prompt_file: promptFile }];
  await savePhaseExperts(phaseId, newExperts);
  await fetchPipeline();
  showToast(`Added to ${phase.name}`);
}

function startDrag(event, id, role, promptFile) {
  draggedExpert = { id, role, promptFile };
  event.dataTransfer.effectAllowed = 'copy';
  event.target.classList.add('dragging');
}

async function dropToPhase(event, phaseId, el) {
  event.preventDefault();
  el.classList.remove('drag-over');
  if (!draggedExpert) return;

  const found = findPhaseAcrossStages(phaseId);
  const phase = found ? found.phase : null;
  if (!phase) return;

  if (phase.experts.some(e => e.id === draggedExpert.id)) {
    showToast('Expert already in this phase');
    draggedExpert = null;
    return;
  }

  let promptFile = draggedExpert.promptFile;
  if (!promptFile) {
    const reg = expertRegistry.find(e => e.id === draggedExpert.id);
    if (reg) promptFile = reg.prompt_file;
  }

  const newExperts = [...phase.experts, { id: draggedExpert.id, role: draggedExpert.role, prompt_file: promptFile }];
  await savePhaseExperts(phaseId, newExperts);
  draggedExpert = null;
  showToast(`Added to ${phase.name}`);
  await fetchPipeline();
}

async function removeExpertFromPhase(phaseId, expertId) {
  const found = findPhaseAcrossStages(phaseId);
  const phase = found ? found.phase : null;
  if (!phase) return;
  const newExperts = phase.experts.filter(e => e.id !== expertId);
  await savePhaseExperts(phaseId, newExperts);
  await fetchPipeline();
}

async function savePhaseExperts(phaseId, experts) {
  try {
    const payload = experts.map(e => {
      const reg = expertRegistry.find(r => r.id === e.id);
      return { id: e.id, role: e.role, prompt_file: e.prompt_file || (reg ? reg.prompt_file : '') };
    });
    const found = findPhaseAcrossStages(phaseId);
    const stg = found ? found.stage : (selectedStage || 1);
    const res = await fetch(`/api/council/phase/${phaseId}/experts?stage=${stg}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experts: payload })
    });
    const data = await res.json();
    if (!data.ok) showToast(`Error: ${data.error}`);
  } catch (e) { showToast(`Error: ${e.message}`); }
}

async function saveContext(level, content, btn) {
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await fetch(`/api/council/context/${level}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.ok) { showToast('Context saved'); btn.closest('.expert-modal-overlay').remove(); }
    else showToast(`Error: ${data.error}`);
  } catch (e) { showToast(`Error: ${e.message}`); }
}

// ── Council execution ───────────────────────────────────────

async function runCouncilPhase(phaseId) {
  const btn = document.getElementById(`btn-phase-${phaseId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  try {
    const stg = selectedStage || 1;
    const res = await fetch('/api/council/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase_id: phaseId, stage: stg }) });
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

async function stopGeneration() {
  if (!currentJobId) return;
  try {
    await fetch(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
    showToast('Stopping generation...');
  } catch (e) {
    showToast(`Error: ${e.message}`);
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
      const statusMap = { complete: { text: 'Complete', cls: 'done' }, cancelled: { text: 'Stopped', cls: 'error' } };
      consoleStatus = statusMap[data.status] || { text: 'Error', cls: 'error' };
      const s = document.getElementById('console-status');
      if (s) { s.textContent = consoleStatus.text; s.className = `console-status ${consoleStatus.cls}`; }
      if (data.error) consolePush({ time: '', message: `Error: ${data.error}`, level: 'error' });
      fetchPipeline();
      const toastMsg = { complete: 'Phase complete', cancelled: 'Generation stopped' };
      showToast(toastMsg[data.status] || `Error: ${data.error}`);
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

async function reconnectActiveJobs() {
  try {
    const res = await fetch('/api/jobs/active');
    const data = await res.json();
    if (data.jobs && data.jobs.length > 0) {
      const job = data.jobs[0];
      currentJobId = job.job_id;
      runningExperts = new Set(job.running_experts || []);
      consoleStatus = { text: `${job.phase_name || ''} ${job.experts_done}/${job.experts_total}`, cls: 'running' };
      consolePush({ time: new Date().toLocaleTimeString().substring(0, 8), message: `Reconnected to running job (${job.phase_name})`, level: 'info' });
      streamJobProgress(job.job_id);
      render();
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  fetchPipeline().then(() => reconnectActiveJobs());
  updateDeadlineCountdown();
  setInterval(updateDeadlineCountdown, 60000);
  document.getElementById('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.getElementById('expert-modal').addEventListener('click', e => { if (e.target.id === 'expert-modal') closeExpertModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); closeExpertModal(); } });
});
