let pipelineData = null;
let councilData = null;
let selectedStage = null;
let activeTab = 'generate';
let currentJobId = null;
let selectedExpert = null;

async function fetchPipeline() {
  const res = await fetch('/api/pipeline');
  pipelineData = await res.json();
  const councilRes = await fetch('/api/council/phases');
  councilData = await councilRes.json();
  render();
}

function render() {
  renderStages();
  renderDetailPanel();
}

// ── Stage cards ─────────────────────────────────────────────

function renderStages() {
  const flow = document.getElementById('pipeline-flow');
  flow.innerHTML = '';

  pipelineData.stages.forEach((stage, i) => {
    if (i > 0) {
      const prevStatus = pipelineData.stages[i - 1].status;
      const connector = document.createElement('div');
      connector.className = `pipeline-connector ${prevStatus === 'approved' ? 'passed' : ''}`;
      connector.innerHTML = prevStatus === 'approved' ? '→' : '⋯';
      flow.appendChild(connector);
    }

    const card = document.createElement('div');
    card.className = 'stage-card';
    if (selectedStage === stage.stage) card.style.borderColor = stage.color;
    card.onclick = () => { selectedStage = stage.stage; selectedExpert = null; render(); };

    card.innerHTML = `
      <div class="stage-header">
        <div class="stage-icon" style="background: ${stage.color}20">${stage.icon}</div>
        <div class="stage-info">
          <h2>Stage ${stage.stage}: ${stage.name}</h2>
          <p>${stage.description}</p>
        </div>
      </div>
      <div class="stage-body">
        <span class="status-badge status-${stage.status}">${stage.status}</span>
        <div class="stage-stats">
          <div class="stat"><span class="stat-value">${stage.artifact_count}</span><span class="stat-label">Artifacts</span></div>
          <div class="stat"><span class="stat-value">${stage.artifacts.filter(a => a.approval === 'approved').length}</span><span class="stat-label">Approved</span></div>
          <div class="stat"><span class="stat-value">${stage.artifacts.filter(a => a.approval === 'pending').length}</span><span class="stat-label">Pending</span></div>
        </div>
      </div>
    `;
    flow.appendChild(card);
  });
}

// ── Detail panel ────────────────────────────────────────────

function renderDetailPanel() {
  const panel = document.getElementById('detail-panel');
  if (!selectedStage) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">←</div><p>Select a stage to get started</p></div>';
    return;
  }

  const stage = pipelineData.stages.find(s => s.stage === selectedStage);
  const tabs = [
    { id: 'generate', label: selectedStage === 1 ? 'Council' : 'Generate' },
    { id: 'artifacts', label: `Results (${stage.artifact_count})` },
    { id: 'config', label: 'Config' },
  ];

  const tabsHtml = tabs.map(t =>
    `<button class="tab ${activeTab === t.id ? 'active' : ''}" onclick="activeTab='${t.id}'; selectedExpert=null; render();">${t.label}</button>`
  ).join('');

  let contentHtml = '';
  if (activeTab === 'generate') contentHtml = renderGeneratePanel(stage);
  else if (activeTab === 'artifacts') contentHtml = renderArtifacts(stage);
  else if (activeTab === 'config') contentHtml = `<div class="config-panel visible">${formatConfig(stage.config)}</div>`;

  panel.innerHTML = `
    <div class="detail-header">
      <h3>${stage.icon} ${stage.name}</h3>
      <span class="status-badge status-${stage.status}">${stage.status}</span>
    </div>
    <div class="tab-bar">${tabsHtml}</div>
    <div id="tab-content">${contentHtml}</div>
  `;
}

// ── Generate panel ──────────────────────────────────────────

function renderGeneratePanel(stage) {
  if (stage.stage === 1) return renderCouncilPanel();
  if (stage.stage === 2) return renderWorldbuildingGenerate();
  if (stage.stage === 3) return renderProductionGenerate();
  return '';
}

function renderCouncilPanel() {
  if (!councilData) return '<div class="generate-panel"><p>Loading...</p></div>';

  // If an expert is selected, show their detail view
  if (selectedExpert) return renderExpertDetail();

  const phases = councilData.phases;
  let html = '<div class="council-layout">';

  // Left: phase list
  html += '<div class="council-phases">';
  phases.forEach((phase, i) => {
    const statusColors = { idle: 'var(--text-muted)', pending: 'var(--info)', approved: 'var(--success)', rejected: 'var(--danger)' };
    const statusIcons = { idle: '○', pending: '◐', approved: '●', rejected: '✕' };

    html += `
      <div class="council-phase phase-active">
        <div class="phase-header">
          <div class="phase-status" style="color:${statusColors[phase.status]}">${statusIcons[phase.status]}</div>
          <div class="phase-title">
            <h4>${phase.name}</h4>
            <p>${phase.description}</p>
          </div>
          <span class="status-badge status-${phase.status}">${phase.status}</span>
        </div>
        <div class="phase-experts">
          ${phase.experts.map(e => `<span class="expert-chip clickable" onclick="event.stopPropagation(); loadExpert('${e.id}')">${e.role}</span>`).join('')}
        </div>
        <div class="phase-actions">
          <button class="btn btn-primary" onclick="event.stopPropagation(); runCouncilPhase('${phase.id}')" id="btn-phase-${phase.id}">
            ${phase.status === 'idle' ? 'Run Phase' : 'Re-run'}
          </button>
          ${phase.status === 'pending' && phase.checkpoint ? `<button class="btn btn-approve btn-sm" onclick="event.stopPropagation(); approvePhase('${phase.id}')">✓ Approve</button>` : ''}
        </div>
      </div>`;

    if (i < phases.length - 1) {
      const cls = phase.status === 'approved' ? 'passed' : '';
      html += `<div class="council-connector ${cls}">${phase.status === 'approved' ? '↓' : '⋮'}</div>`;
    }
  });
  html += '</div>';

  // Right: console
  html += '<div class="console-panel">';
  html += '<div class="console-header"><h4>Console</h4>';
  if (currentJobId) html += `<span class="console-status" id="console-status">Running...</span>`;
  html += '</div>';
  html += '<div class="console-log" id="console-log">';
  html += '<div class="console-empty">Run a phase to see live progress here</div>';
  html += '</div></div>';

  html += '</div>';
  return html;
}

function renderExpertDetail() {
  // Placeholder — will be filled by loadExpert()
  return `<div class="expert-detail" id="expert-detail-container"><div class="empty-state"><p>Loading expert...</p></div></div>`;
}

async function loadExpert(expertId) {
  selectedExpert = expertId;
  render();

  const res = await fetch(`/api/council/expert/${expertId}`);
  const data = await res.json();
  const container = document.getElementById('expert-detail-container');
  if (!container) return;

  const hasOutput = data.output && data.output.content;

  container.innerHTML = `
    <div class="expert-header-bar">
      <button class="btn btn-sm" onclick="selectedExpert=null; render();">← Back to phases</button>
      <span class="status-badge status-${hasOutput ? 'approved' : 'idle'}">${hasOutput ? 'has output' : 'not run'}</span>
    </div>
    <div class="expert-title">
      <h3>${data.role}</h3>
      <p class="gen-desc">Phase: ${data.phase_name} · Receives: ${data.receives.length ? data.receives.join(', ') : 'none (independent)'}</p>
    </div>
    <div class="expert-tabs">
      <button class="gen-tab active" onclick="showExpertTab(this, 'expert-prompt')">Prompt</button>
      ${hasOutput ? '<button class="gen-tab" onclick="showExpertTab(this, \'expert-output\')">Output</button>' : ''}
    </div>
    <div id="expert-prompt" class="expert-content">
      <div class="expert-prompt-text">${escapeHtml(data.prompt)}</div>
    </div>
    ${hasOutput ? `
      <div id="expert-output" class="expert-content" style="display:none;">
        <div class="expert-output-text">${renderMarkdown(data.output.content)}</div>
      </div>
    ` : ''}
  `;
}

function showExpertTab(btn, tabId) {
  const container = document.getElementById('expert-detail-container');
  container.querySelectorAll('.expert-content').forEach(el => el.style.display = 'none');
  container.querySelectorAll('.gen-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).style.display = 'block';
}

// ── Council execution with SSE ──────────────────────────────

async function runCouncilPhase(phaseId) {
  const btn = document.getElementById(`btn-phase-${phaseId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  try {
    const res = await fetch('/api/council/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase_id: phaseId }),
    });
    const data = await res.json();
    if (!data.ok) { showToast(`Error: ${data.error}`); return; }

    currentJobId = data.job_id;
    render();

    // Wait a tick for DOM to render, then start SSE
    await new Promise(r => setTimeout(r, 100));
    streamJobProgress(data.job_id);

  } catch (e) {
    showToast(`Error: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Run Phase'; }
  }
}

function streamJobProgress(jobId) {
  const logEl = document.getElementById('console-log');
  const statusEl = document.getElementById('console-status');
  if (logEl) logEl.innerHTML = '';

  const evtSource = new EventSource(`/api/jobs/${jobId}/stream`);

  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'log') {
      if (logEl) {
        const line = document.createElement('div');
        line.className = 'console-line';
        line.innerHTML = `<span class="console-time">${data.time}</span> ${escapeHtml(data.message)}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
      }

      if (statusEl && data.experts_total > 0) {
        statusEl.textContent = `${data.experts_done}/${data.experts_total} experts`;
        statusEl.className = 'console-status running';
      }
    }

    if (data.type === 'done') {
      evtSource.close();
      currentJobId = null;

      if (statusEl) {
        statusEl.textContent = data.status === 'complete' ? 'Complete' : 'Error';
        statusEl.className = `console-status ${data.status === 'complete' ? 'done' : 'error'}`;
      }
      if (data.error && logEl) {
        const line = document.createElement('div');
        line.className = 'console-line console-error';
        line.textContent = `Error: ${data.error}`;
        logEl.appendChild(line);
      }

      // Refresh data
      fetchPipeline();
      showToast(data.status === 'complete' ? 'Phase complete' : `Error: ${data.error}`);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    if (statusEl) {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'console-status error';
    }
  };
}

async function approvePhase(phaseId) {
  if (!pipelineData) return;
  const stage = pipelineData.stages.find(s => s.stage === 1);
  if (!stage) return;
  const phaseArtifacts = stage.artifacts.filter(
    a => a.content?.phase === phaseId && a.approval === 'pending'
  );
  for (const a of phaseArtifacts) {
    await fetch(`/api/artifacts/1/${a._filename}/approve`, { method: 'POST' });
  }
  showToast(`${phaseId} phase approved`);
  await fetchPipeline();
}

// ── Artifacts tab ───────────────────────────────────────────

function renderArtifacts(stage) {
  if (stage.artifacts.length === 0) {
    return '<div class="empty-state"><div class="empty-icon">📭</div><p>No artifacts yet. Run a phase to generate content.</p></div>';
  }

  let html = '<ul class="artifact-list">';
  stage.artifacts.forEach(a => {
    const created = new Date(a.created_at).toLocaleString();
    const images = a.content?.images || a.content?.views || [];
    const hasImages = images.length > 0;
    const hasExperts = a.content?.expert_outputs && a.content.expert_outputs.length > 0;
    const label = a.content?.label || a.content?.name || a.content?.phase_name || a.type;

    html += `<li class="artifact-item-full">
      <div class="artifact-row">
        <div class="artifact-info">
          <span class="artifact-type">${label}</span>
          <span class="artifact-meta">${a.type} · v${a.version} · ${created}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <span class="status-badge status-${a.approval}">${a.approval}</span>
          <div class="artifact-actions">
            <button class="btn btn-sm btn-approve" onclick="updateArtifact(${stage.stage}, '${a._filename}', 'approve')">✓</button>
            <button class="btn btn-sm btn-revise" onclick="updateArtifact(${stage.stage}, '${a._filename}', 'revision')">↻</button>
            <button class="btn btn-sm btn-reject" onclick="updateArtifact(${stage.stage}, '${a._filename}', 'reject')">✕</button>
            <button class="btn btn-sm" onclick="deleteArtifact(${stage.stage}, '${a._filename}')" style="color:var(--text-muted)">🗑</button>
          </div>
        </div>
      </div>
      ${hasImages ? renderImageGrid(images) : ''}
      ${hasExperts ? renderExpertOutputs(a.content.expert_outputs) : ''}
    </li>`;
  });
  html += '</ul>';
  return html;
}

function renderExpertOutputs(outputs) {
  let html = '<div class="expert-outputs">';
  outputs.forEach(o => {
    const preview = o.content.substring(0, 200).replace(/[#*`]/g, '');
    html += `
      <div class="expert-output-card" onclick="this.classList.toggle('expanded')">
        <div class="expert-output-header">
          <span class="expert-output-role">${o.role}</span>
          <span class="expert-output-meta">${o.content.length} chars</span>
        </div>
        <div class="expert-output-preview">${escapeHtml(preview)}...</div>
        <div class="expert-output-full">${renderMarkdown(o.content)}</div>
      </div>`;
  });
  html += '</div>';
  return html;
}

function renderImageGrid(images) {
  let html = '<div class="image-grid">';
  images.forEach(img => {
    const url = img.url || img.imageURL;
    const label = img.view || '';
    if (url) {
      html += `<div class="image-thumb" onclick="openLightbox('${url}')">
        <img src="${url}" alt="${label}" loading="lazy">
        ${label ? `<span class="image-label">${label}</span>` : ''}
      </div>`;
    }
  });
  html += '</div>';
  return html;
}

// ── Worldbuilding / Production generate panels ──────────────

function renderWorldbuildingGenerate() {
  return `
    <div class="generate-panel">
      <div class="generate-tabs">
        <button class="gen-tab active" onclick="showGenSub(this, 'gen-freeform')">Freeform</button>
        <button class="gen-tab" onclick="showGenSub(this, 'gen-character')">Character</button>
        <button class="gen-tab" onclick="showGenSub(this, 'gen-environment')">Environment</button>
      </div>
      <div id="gen-freeform" class="gen-sub">
        <div class="form-group"><label>Prompt</label><textarea id="ff-prompt" rows="3" placeholder="Describe what you want to generate..."></textarea></div>
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
        <div class="form-group"><label>Description</label><textarea id="ch-desc" rows="3" placeholder="Young scientist with cybernetic arm..."></textarea></div>
        <div class="form-group"><label>Style (optional)</label><input id="ch-style" type="text" placeholder="grounded sci-fi, warm palette"></div>
        <button class="btn btn-primary" onclick="generateCharacter()" id="btn-ch">Generate Character Sheet</button>
      </div>
      <div id="gen-environment" class="gen-sub" style="display:none;">
        <div class="form-group"><label>Name</label><input id="env-name" type="text" placeholder="e.g. Metaninoa Central Hub"></div>
        <div class="form-group"><label>Description</label><textarea id="env-desc" rows="3" placeholder="A vast organic atrium..."></textarea></div>
        <div class="form-group"><label>Style (optional)</label><input id="env-style" type="text" placeholder="golden hour, cinematic"></div>
        <button class="btn btn-primary" onclick="generateEnvironment()" id="btn-env">Generate Environment</button>
      </div>
    </div>`;
}

function renderProductionGenerate() {
  return `
    <div class="generate-panel">
      <div class="form-group"><label>Shot Description</label><textarea id="shot-desc" rows="3" placeholder="Wide establishing shot of the city at dawn..."></textarea></div>
      <div class="form-group"><label>Style (optional)</label><input id="shot-style" type="text" placeholder="anamorphic lens, cinematic"></div>
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
  const btn = document.getElementById('btn-ff');
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const body = {
      prompt: document.getElementById('ff-prompt').value,
      width: parseInt(document.getElementById('ff-w').value),
      height: parseInt(document.getElementById('ff-h').value),
      number_results: parseInt(document.getElementById('ff-n').value),
      stage: 2, artifact_type: 'concept',
      label: document.getElementById('ff-label').value,
    };
    const res = await fetch('/api/generate/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) { showToast(`Generated ${data.images.length} image(s)`); activeTab = 'artifacts'; await fetchPipeline(); }
    else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate'; }
}

async function generateCharacter() {
  const btn = document.getElementById('btn-ch');
  btn.disabled = true; btn.textContent = 'Generating 3 views...';
  try {
    const res = await fetch('/api/generate/character', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: document.getElementById('ch-name').value, description: document.getElementById('ch-desc').value, style_prompt: document.getElementById('ch-style').value }) });
    const data = await res.json();
    if (data.ok) { showToast('Character sheet generated'); activeTab = 'artifacts'; await fetchPipeline(); }
    else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate Character Sheet'; }
}

async function generateEnvironment() {
  const btn = document.getElementById('btn-env');
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/environment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: document.getElementById('env-name').value, description: document.getElementById('env-desc').value, style_prompt: document.getElementById('env-style').value }) });
    const data = await res.json();
    if (data.ok) { showToast('Environment generated'); activeTab = 'artifacts'; await fetchPipeline(); }
    else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate Environment'; }
}

async function generateShot() {
  const btn = document.getElementById('btn-shot');
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/shot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: document.getElementById('shot-desc').value, style_prompt: document.getElementById('shot-style').value,
        width: parseInt(document.getElementById('shot-w').value), height: parseInt(document.getElementById('shot-h').value) }) });
    const data = await res.json();
    if (data.ok) { showToast('Shot generated'); activeTab = 'artifacts'; await fetchPipeline(); }
    else showToast(`Error: ${data.error}`);
  } finally { btn.disabled = false; btn.textContent = 'Generate Shot'; }
}

// ── Artifact actions ────────────────────────────────────────

async function updateArtifact(stage, filename, action) {
  const res = await fetch(`/api/artifacts/${stage}/${filename}/${action}`, { method: 'POST' });
  const data = await res.json();
  if (data.ok) { showToast({ approve: 'Approved', reject: 'Rejected', revision: 'Revision requested' }[action]); await fetchPipeline(); }
}

async function deleteArtifact(stage, filename) {
  if (!confirm('Delete this artifact?')) return;
  await fetch(`/api/artifacts/${stage}/${filename}`, { method: 'DELETE' });
  showToast('Deleted'); await fetchPipeline();
}

// ── Utilities ───────────────────────────────────────────────

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(text) {
  // Minimal markdown: headers, bold, code blocks
  let html = escapeHtml(text);
  html = html.replace(/^### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^## (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function formatConfig(config) {
  return JSON.stringify(config, null, 2).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('visible');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('visible'); }

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
});
