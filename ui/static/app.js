let pipelineData = null;
let councilData = null;
let selectedStage = null;
let activeTab = 'artifacts';

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
    card.onclick = () => { selectedStage = stage.stage; activeTab = 'artifacts'; render(); };

    card.innerHTML = `
      <div class="stage-header">
        <div class="stage-icon" style="background: ${stage.color}20">${stage.icon}</div>
        <div class="stage-info">
          <h2>Stage ${stage.stage}: ${stage.name}</h2>
          <p>${stage.description}</p>
        </div>
      </div>
      <div class="stage-body">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span class="status-badge status-${stage.status}">${stage.status}</span>
        </div>
        <div class="stage-stats">
          <div class="stat">
            <span class="stat-value">${stage.artifact_count}</span>
            <span class="stat-label">Artifacts</span>
          </div>
          <div class="stat">
            <span class="stat-value">${stage.artifacts.filter(a => a.approval === 'approved').length}</span>
            <span class="stat-label">Approved</span>
          </div>
          <div class="stat">
            <span class="stat-value">${stage.artifacts.filter(a => a.approval === 'pending').length}</span>
            <span class="stat-label">Pending</span>
          </div>
        </div>
      </div>
      <div class="stage-actions">
        <button class="btn btn-primary" onclick="event.stopPropagation(); selectedStage=${stage.stage}; activeTab='generate'; render();">
          Generate
        </button>
        <button class="btn" onclick="event.stopPropagation(); selectedStage=${stage.stage}; activeTab='config'; render();">
          Config
        </button>
      </div>
    `;
    flow.appendChild(card);
  });
}

function renderDetailPanel() {
  const panel = document.getElementById('detail-panel');

  if (!selectedStage) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">←</div>
        <p>Select a stage above to view artifacts, generate content, or review configuration</p>
      </div>`;
    return;
  }

  const stage = pipelineData.stages.find(s => s.stage === selectedStage);

  const tabs = [
    { id: 'artifacts', label: 'Artifacts' },
    { id: 'generate', label: 'Generate' },
    { id: 'config', label: 'Configuration' },
  ];

  const tabsHtml = tabs.map(t =>
    `<button class="tab ${activeTab === t.id ? 'active' : ''}" onclick="activeTab='${t.id}'; render();">${t.label}</button>`
  ).join('');

  let contentHtml = '';
  if (activeTab === 'artifacts') contentHtml = renderArtifacts(stage);
  else if (activeTab === 'generate') contentHtml = renderGeneratePanel(stage);
  else if (activeTab === 'config') contentHtml = renderConfig(stage);

  panel.innerHTML = `
    <div class="detail-header">
      <h3>${stage.icon} ${stage.name}</h3>
      <span class="status-badge status-${stage.status}">${stage.status}</span>
    </div>
    <div class="tab-bar">${tabsHtml}</div>
    <div id="tab-content">${contentHtml}</div>
  `;
}

function renderArtifacts(stage) {
  if (stage.artifacts.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>No artifacts yet. Use the Generate tab to create content.</p>
      </div>`;
  }

  let html = '<ul class="artifact-list">';
  stage.artifacts.forEach(a => {
    const created = new Date(a.created_at).toLocaleString();
    const images = a.content?.images || a.content?.views || [];
    const hasImages = images.length > 0;
    const label = a.content?.label || a.content?.name || a.content?.description || a.type;

    html += `
      <li class="artifact-item-full">
        <div class="artifact-row">
          <div class="artifact-info">
            <span class="artifact-type">${label}</span>
            <span class="artifact-meta">${a.type} · v${a.version} · ${created}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span class="status-badge status-${a.approval}">${a.approval}</span>
            <div class="artifact-actions">
              <button class="btn btn-sm btn-approve" onclick="updateArtifact(${stage.stage}, '${a._filename}', 'approve')" title="Approve">✓</button>
              <button class="btn btn-sm btn-revise" onclick="updateArtifact(${stage.stage}, '${a._filename}', 'revision')" title="Revision">↻</button>
              <button class="btn btn-sm btn-reject" onclick="updateArtifact(${stage.stage}, '${a._filename}', 'reject')" title="Reject">✕</button>
              <button class="btn btn-sm" onclick="deleteArtifact(${stage.stage}, '${a._filename}')" title="Delete" style="color:var(--text-muted)">🗑</button>
            </div>
          </div>
        </div>
        ${hasImages ? renderImageGrid(images) : ''}
      </li>`;
  });
  html += '</ul>';
  return html;
}

function renderImageGrid(images) {
  let html = '<div class="image-grid">';
  images.forEach(img => {
    const url = img.url || img.imageURL;
    const label = img.view || '';
    if (url) {
      html += `
        <div class="image-thumb" onclick="openLightbox('${url}')">
          <img src="${url}" alt="${label}" loading="lazy">
          ${label ? `<span class="image-label">${label}</span>` : ''}
        </div>`;
    }
  });
  html += '</div>';
  return html;
}

function renderGeneratePanel(stage) {
  if (stage.stage === 1) return renderCouncilGenerate();
  if (stage.stage === 2) return renderWorldbuildingGenerate();
  if (stage.stage === 3) return renderProductionGenerate();
  return '';
}

function renderCouncilGenerate() {
  if (!councilData) return '<div class="generate-panel"><p>Loading council data...</p></div>';

  const phases = councilData.phases;
  const statusColors = {
    idle: 'var(--text-muted)', pending: 'var(--info)',
    approved: 'var(--success)', rejected: 'var(--danger)',
  };
  const statusIcons = {
    idle: '○', pending: '◐', approved: '●', rejected: '✕',
  };

  let html = '<div class="generate-panel council-panel">';

  // Phase flow
  html += '<div class="council-flow">';
  phases.forEach((phase, i) => {
    const canRun = i === 0 || phases[i - 1].status === 'approved';
    const isActive = phase.status === 'pending' || (canRun && phase.status === 'idle');

    html += `
      <div class="council-phase ${isActive ? 'phase-active' : ''} ${phase.status === 'approved' ? 'phase-done' : ''}">
        <div class="phase-header">
          <div class="phase-status" style="color:${statusColors[phase.status]}">
            ${statusIcons[phase.status]}
          </div>
          <div class="phase-title">
            <h4>${phase.name}</h4>
            <p>${phase.description}</p>
          </div>
          <span class="status-badge status-${phase.status}">${phase.status}</span>
        </div>
        <div class="phase-experts">
          ${phase.experts.map(e => `<span class="expert-chip">${e.role}</span>`).join('')}
        </div>
        <div class="phase-actions">
          ${canRun && phase.status !== 'approved' ? `
            <button class="btn btn-primary" onclick="runCouncilPhase('${phase.id}')" id="btn-phase-${phase.id}">
              ${phase.status === 'idle' ? 'Run Phase' : 'Re-run Phase'}
            </button>
          ` : ''}
          ${phase.status === 'pending' && phase.checkpoint ? `
            <button class="btn btn-approve btn-sm" onclick="approvePhase('${phase.id}')" title="Approve all artifacts in this phase">
              ✓ Approve Phase
            </button>
          ` : ''}
        </div>
      </div>`;

    if (i < phases.length - 1) {
      const connectorClass = phase.status === 'approved' ? 'passed' : '';
      html += `<div class="council-connector ${connectorClass}">${phase.status === 'approved' ? '↓' : '⋮'}</div>`;
    }
  });
  html += '</div>';

  // Run all button
  const allIdle = phases.every(p => p.status === 'idle');
  if (allIdle) {
    html += `
      <div style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid var(--border);">
        <p class="gen-desc">Or run the full council pipeline — each phase runs sequentially, stopping at checkpoints for your review.</p>
        <button class="btn btn-primary" onclick="runCouncilPhase(null)" id="btn-council-all">Run Full Council</button>
      </div>`;
  }

  html += '</div>';
  return html;
}

function renderWorldbuildingGenerate() {
  return `
    <div class="generate-panel">
      <div class="generate-tabs">
        <button class="gen-tab active" onclick="showGenSub(this, 'gen-freeform')">Freeform</button>
        <button class="gen-tab" onclick="showGenSub(this, 'gen-character')">Character</button>
        <button class="gen-tab" onclick="showGenSub(this, 'gen-environment')">Environment</button>
      </div>

      <div id="gen-freeform" class="gen-sub">
        <div class="form-group">
          <label>Prompt</label>
          <textarea id="ff-prompt" rows="3" placeholder="Describe what you want to generate..."></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Negative Prompt</label>
            <input id="ff-neg" type="text" placeholder="blurry, low quality, text">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group half">
            <label>Width</label>
            <input id="ff-w" type="number" value="1024">
          </div>
          <div class="form-group half">
            <label>Height</label>
            <input id="ff-h" type="number" value="1024">
          </div>
          <div class="form-group half">
            <label>Results</label>
            <input id="ff-n" type="number" value="1" min="1" max="4">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group half">
            <label>Steps</label>
            <input id="ff-steps" type="number" value="30" min="1" max="100">
          </div>
          <div class="form-group half">
            <label>CFG Scale</label>
            <input id="ff-cfg" type="number" value="7" step="0.5" min="1" max="20">
          </div>
          <div class="form-group half">
            <label>Seed (optional)</label>
            <input id="ff-seed" type="number" placeholder="Random">
          </div>
        </div>
        <div class="form-group">
          <label>Label</label>
          <input id="ff-label" type="text" placeholder="Name this generation">
        </div>
        <button class="btn btn-primary" onclick="generateFreeform()" id="btn-ff">Generate Image</button>
      </div>

      <div id="gen-character" class="gen-sub" style="display:none;">
        <div class="form-group">
          <label>Character Name</label>
          <input id="ch-name" type="text" placeholder="e.g. Kael">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="ch-desc" rows="3" placeholder="Young scientist with cybernetic arm, wearing a weathered lab coat..."></textarea>
        </div>
        <div class="form-group">
          <label>Style Prompt (optional)</label>
          <input id="ch-style" type="text" placeholder="e.g. grounded sci-fi, warm palette">
        </div>
        <p class="gen-desc">Generates front, three-quarter, and profile views for character consistency.</p>
        <button class="btn btn-primary" onclick="generateCharacter()" id="btn-ch">Generate Character Sheet</button>
      </div>

      <div id="gen-environment" class="gen-sub" style="display:none;">
        <div class="form-group">
          <label>Environment Name</label>
          <input id="env-name" type="text" placeholder="e.g. Metaninoa Central Hub">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="env-desc" rows="3" placeholder="A vast organic atrium with living walls, sunlight filtering through bio-luminescent canopy..."></textarea>
        </div>
        <div class="form-group">
          <label>Style Prompt (optional)</label>
          <input id="env-style" type="text" placeholder="e.g. golden hour lighting, cinematic">
        </div>
        <p class="gen-desc">Generates 1920×1080 environment concept art (2 variations).</p>
        <button class="btn btn-primary" onclick="generateEnvironment()" id="btn-env">Generate Environment</button>
      </div>
    </div>`;
}

function renderProductionGenerate() {
  return `
    <div class="generate-panel">
      <div class="generate-section">
        <h4>Shot Generation</h4>
        <div class="form-group">
          <label>Shot Description</label>
          <textarea id="shot-desc" rows="3" placeholder="Wide establishing shot of the city at dawn, golden light reflecting off crystalline towers..."></textarea>
        </div>
        <div class="form-group">
          <label>Style Prompt (optional)</label>
          <input id="shot-style" type="text" placeholder="e.g. anamorphic lens, cinematic color grade">
        </div>
        <div class="form-row">
          <div class="form-group half">
            <label>Width</label>
            <input id="shot-w" type="number" value="1920">
          </div>
          <div class="form-group half">
            <label>Height</label>
            <input id="shot-h" type="number" value="1080">
          </div>
        </div>
        <button class="btn btn-primary" onclick="generateShot()" id="btn-shot">Generate Shot</button>
      </div>
    </div>`;
}

function renderConfig(stage) {
  return `<div class="config-panel visible">${formatConfig(stage.config)}</div>`;
}

function showGenSub(btn, id) {
  btn.closest('.generate-panel').querySelectorAll('.gen-sub').forEach(el => el.style.display = 'none');
  btn.closest('.generate-tabs').querySelectorAll('.gen-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).style.display = 'block';
}

function formatConfig(config) {
  return JSON.stringify(config, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Generation actions ──────────────────────────────────────

async function generateFreeform() {
  const btn = document.getElementById('btn-ff');
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const body = {
      prompt: document.getElementById('ff-prompt').value,
      negative_prompt: document.getElementById('ff-neg').value || '',
      width: parseInt(document.getElementById('ff-w').value),
      height: parseInt(document.getElementById('ff-h').value),
      number_results: parseInt(document.getElementById('ff-n').value),
      steps: parseInt(document.getElementById('ff-steps').value),
      cfg_scale: parseFloat(document.getElementById('ff-cfg').value),
      stage: 2,
      artifact_type: 'concept',
      label: document.getElementById('ff-label').value,
    };
    const seedVal = document.getElementById('ff-seed').value;
    if (seedVal) body.seed = parseInt(seedVal);

    const res = await fetch('/api/generate/image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Generated ${data.images.length} image(s)`);
      activeTab = 'artifacts';
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Image';
  }
}

async function generateCharacter() {
  const btn = document.getElementById('btn-ch');
  btn.disabled = true; btn.textContent = 'Generating 3 views...';
  try {
    const res = await fetch('/api/generate/character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('ch-name').value,
        description: document.getElementById('ch-desc').value,
        style_prompt: document.getElementById('ch-style').value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Character sheet generated (${data.views.length} views)`);
      activeTab = 'artifacts';
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Character Sheet';
  }
}

async function generateEnvironment() {
  const btn = document.getElementById('btn-env');
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/environment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('env-name').value,
        description: document.getElementById('env-desc').value,
        style_prompt: document.getElementById('env-style').value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Environment generated (${data.images.length} variations)`);
      activeTab = 'artifacts';
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Environment';
  }
}

async function generateShot() {
  const btn = document.getElementById('btn-shot');
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/generate/shot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: document.getElementById('shot-desc').value,
        style_prompt: document.getElementById('shot-style').value,
        width: parseInt(document.getElementById('shot-w').value),
        height: parseInt(document.getElementById('shot-h').value),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Shot generated');
      activeTab = 'artifacts';
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Shot';
  }
}

async function runStage(stage) {
  const res = await fetch(`/api/stages/${stage}/run`, { method: 'POST' });
  const data = await res.json();
  showToast(data.message);
  await fetchPipeline();
}

async function runCouncilPhase(phaseId) {
  const btnId = phaseId ? `btn-phase-${phaseId}` : 'btn-council-all';
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = 'Running experts...'; }

  showToast(phaseId ? `Running ${phaseId} phase...` : 'Running full council...');

  try {
    const res = await fetch('/api/council/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase_id: phaseId }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message);
      activeTab = 'artifacts';
      await fetchPipeline();
    } else {
      showToast(`Error: ${data.error}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = phaseId ? 'Run Phase' : 'Run Full Council'; }
  }
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

// ── Artifact actions ────────────────────────────────────────

async function updateArtifact(stage, filename, action) {
  const res = await fetch(`/api/artifacts/${stage}/${filename}/${action}`, { method: 'POST' });
  const data = await res.json();
  if (data.ok) {
    const labels = { approve: 'Approved', reject: 'Rejected', revision: 'Revision requested' };
    showToast(labels[action] || action);
    await fetchPipeline();
  }
}

async function deleteArtifact(stage, filename) {
  if (!confirm('Delete this artifact?')) return;
  const res = await fetch(`/api/artifacts/${stage}/${filename}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    showToast('Artifact deleted');
    await fetchPipeline();
  }
}

// ── Lightbox ────────────────────────────────────────────────

function openLightbox(url) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = url;
  lb.classList.add('visible');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('visible');
}

// ── Toast ───────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

function updateDeadlineCountdown() {
  const deadline = new Date('2026-08-14T23:59:59');
  const now = new Date();
  const diff = deadline - now;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const el = document.getElementById('countdown');
  if (el) el.textContent = `${days} days remaining`;
}

document.addEventListener('DOMContentLoaded', () => {
  fetchPipeline();
  updateDeadlineCountdown();
  setInterval(updateDeadlineCountdown, 60000);

  document.getElementById('lightbox').addEventListener('click', e => {
    if (e.target.id === 'lightbox') closeLightbox();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
});
