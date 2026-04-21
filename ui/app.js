// site-monitor UI
// Lee status.json / incidents.json / sites.json desde GitHub (raw)
// Escribe sites.json vía GitHub Contents API con PAT guardado en localStorage

const CFG_KEY = 'site-monitor:config';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let CFG = loadConfig();
let STATE = { sites: [], status: { sites: {} }, incidents: [], filter: 'all' };

// ---------- Config ----------
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
  catch { return {}; }
}
function saveConfig(c) {
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  CFG = c;
}
function cfgComplete() {
  return CFG.owner && CFG.repo && CFG.branch;
}

// ---------- GitHub API ----------
async function ghRaw(path) {
  // Cache-bust con timestamp
  const url = `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/${path}?t=${Date.now()}`;
  const headers = {};
  if (CFG.token) headers.authorization = `token ${CFG.token}`;
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return r.json();
}

async function ghGetFile(path) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${path}?ref=${CFG.branch}`;
  const r = await fetch(url, {
    headers: { authorization: `token ${CFG.token}`, accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GET contents ${path}: ${r.status}`);
  const data = await r.json();
  return { sha: data.sha, content: JSON.parse(atob(data.content.replace(/\n/g, ''))) };
}

async function ghPutFile(path, jsonObj, message, sha) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${path}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(jsonObj, null, 2) + '\n')));
  const body = { message, content, branch: CFG.branch, sha };
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `token ${CFG.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error(`PUT ${path}: ${r.status} ${e}`);
  }
  return r.json();
}

// ---------- Data load ----------
async function loadAll() {
  if (!cfgComplete()) {
    openConfig();
    return;
  }
  try {
    const [sites, status, incidents] = await Promise.all([
      ghRaw('data/sites.json').catch(() => ({ sites: [] })),
      ghRaw('data/status.json').catch(() => ({ sites: {}, lastRun: null })),
      ghRaw('data/incidents.json').catch(() => ({ incidents: [] })),
    ]);
    STATE.sites = sites.sites || [];
    STATE.status = status;
    STATE.incidents = incidents.incidents || [];
    render();
  } catch (e) {
    toast(`Error cargando: ${e.message}`, 'err');
  }
}

// ---------- Render ----------
function render() {
  renderHeader();
  renderStats();
  renderSites();
  renderIncidents();
}

function renderHeader() {
  const ts = STATE.status?.lastRun;
  $('#lastRun').textContent = ts ? `last run · ${relativeTime(ts)}` : 'sin datos';
}

function renderStats() {
  const sites = STATE.sites;
  const st = STATE.status.sites || {};
  let up = 0, down = 0, latSum = 0, latCount = 0;
  for (const s of sites) {
    if (!s.enabled && s.enabled !== undefined) continue;
    const x = st[s.domain];
    if (!x) continue;
    if (x.isUp) up++; else down++;
    if (x.http?.latencyMs) { latSum += x.http.latencyMs; latCount++; }
  }
  $('#sCount').textContent = sites.length;
  $('#sUp').textContent = up;
  $('#sDown').textContent = down;
  $('#sLat').textContent = latCount ? `${Math.round(latSum / latCount)}ms` : '—';
}

function renderSites() {
  const el = $('#sitesTable');
  if (STATE.sites.length === 0) {
    el.innerHTML = `<div class="empty">
      <p>No hay sitios configurados.</p>
      <p>Apretá <b>+ agregar</b> para empezar.</p>
    </div>`;
    return;
  }
  const st = STATE.status.sites || {};
  el.innerHTML = STATE.sites.map(s => {
    const x = st[s.domain];
    const isUp = x?.isUp;
    const dotClass = !x ? 'pending' : (isUp ? 'ok' : 'down');
    const layer = x?.layer || 'PENDING';
    const layerCls = !x ? '' : (isUp ? 'ok' : (x.severity === 'critical' ? 'crit' : 'warn'));
    const status = x?.http?.status ?? '—';
    const lat = x?.http?.latencyMs ? `${x.http.latencyMs}ms` : '—';
    const latBad = x?.http?.latencyMs > 3000 ? 'bad' : '';
    const cf = x?.http?.viaCloudflare;
    const cfBadge = x ? `<span class="cfbadge ${cf ? 'on' : ''}">${cf ? 'CF' : 'no-CF'}</span>` : '';
    const last = x?.lastCheck ? relativeTime(x.lastCheck) : '—';
    return `<div class="row" data-domain="${escapeAttr(s.domain)}">
      <span class="statusdot ${dotClass}"></span>
      <span class="domain">${escapeHtml(s.domain)}</span>
      <span class="layer ${layerCls}">${escapeHtml(layer)}</span>
      <span class="num ${latBad}">${lat}</span>
      <span class="num">${status}</span>
      <span class="num">${last}</span>
      ${cfBadge}
    </div>`;
  }).join('');

  $$('#sitesTable .row').forEach(r => {
    r.addEventListener('click', () => openDetail(r.dataset.domain));
  });
}

function renderIncidents() {
  const list = STATE.incidents.filter(i => {
    if (STATE.filter === 'open') return !i.resolved;
    if (STATE.filter === 'resolved') return i.resolved;
    return true;
  });
  const el = $('#incidentsList');
  if (list.length === 0) {
    el.innerHTML = `<div class="empty"><p>Sin incidentes registrados.</p></div>`;
    return;
  }
  el.innerHTML = list.map(i => `
    <div class="incident">
      <div class="when">
        ${fmtDateShort(i.detectedAt)}
        ${i.resolved && i.resolvedAt ? `<br><span style="opacity:.7">→ ${fmtDateShort(i.resolvedAt)}</span>` : ''}
      </div>
      <div class="body">
        <div class="head">
          <span class="sev ${i.severity}">${i.severity}</span>
          <span class="dom">${escapeHtml(i.domain)}</span>
          <span class="layer">${escapeHtml(i.layer)}</span>
        </div>
        <div class="summ">${escapeHtml(i.summary)}</div>
      </div>
      <div class="status ${i.resolved ? 'resolved' : 'open'}">${i.resolved ? 'RESUELTO' : 'ABIERTO'}</div>
    </div>
  `).join('');
}

// ---------- Modals ----------
function openConfig() {
  const d = $('#configModal');
  d.querySelector('[name=owner]').value = CFG.owner || '';
  d.querySelector('[name=repo]').value = CFG.repo || '';
  d.querySelector('[name=branch]').value = CFG.branch || 'main';
  d.querySelector('[name=token]').value = CFG.token || '';
  d.showModal();
}

$('#btnConfig').onclick = openConfig;
$('#btnRefresh').onclick = () => loadAll();

$('#configModal').addEventListener('close', () => {
  const d = $('#configModal');
  if (d.returnValue !== 'save') return;
  const data = new FormData(d.querySelector('form'));
  const next = {
    owner: data.get('owner').trim(),
    repo: data.get('repo').trim(),
    branch: (data.get('branch') || 'main').trim(),
    token: data.get('token').trim(),
  };
  if (!next.owner || !next.repo) return toast('Owner y repo son obligatorios', 'err');
  saveConfig(next);
  toast('Config guardada', 'ok');
  loadAll();
});

$('#btnAdd').onclick = () => {
  if (!CFG.token) return toast('Falta PAT en config', 'err');
  $('#addModal').querySelector('form').reset();
  $('#addModal').showModal();
};

$('#addModal').addEventListener('close', async () => {
  const d = $('#addModal');
  if (d.returnValue !== 'save') return;
  const f = new FormData(d.querySelector('form'));
  const site = {
    domain: (f.get('domain') || '').trim().toLowerCase(),
    enabled: true,
    expectedStatus: Number(f.get('expectedStatus')) || 200,
    expectedContent: (f.get('expectedContent') || '').trim() || null,
    expectedNS: 'cloudflare.com',
    notes: (f.get('notes') || '').trim() || null,
  };
  if (!site.domain) return;
  await addSite(site);
});

$$('.chip').forEach(c => {
  c.onclick = () => {
    $$('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    STATE.filter = c.dataset.filter;
    renderIncidents();
  };
});

function openDetail(domain) {
  const site = STATE.sites.find(s => s.domain === domain);
  const st = STATE.status.sites?.[domain];
  $('#detailTitle').textContent = domain;
  $('#detailBody').textContent = JSON.stringify({ site, status: st }, null, 2);
  const d = $('#detailModal');
  $('#btnRemove').onclick = async () => {
    if (!confirm(`¿Eliminar ${domain} del monitor?`)) return;
    await removeSite(domain);
    d.close();
  };
  $('#btnCloseDetail').onclick = () => d.close();
  d.showModal();
}

// ---------- Writes ----------
async function addSite(site) {
  if (!CFG.token) return toast('Falta PAT', 'err');
  try {
    const { sha, content } = await ghGetFile('data/sites.json');
    if (content.sites.some(s => s.domain === site.domain)) {
      return toast('Ese dominio ya está en la lista', 'err');
    }
    content.sites.push(site);
    await ghPutFile('data/sites.json', content, `add: ${site.domain}`, sha);
    toast(`${site.domain} agregado. Se chequea en el próximo ciclo.`, 'ok');
    setTimeout(loadAll, 800);
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}

async function removeSite(domain) {
  try {
    const { sha, content } = await ghGetFile('data/sites.json');
    content.sites = content.sites.filter(s => s.domain !== domain);
    await ghPutFile('data/sites.json', content, `remove: ${domain}`, sha);
    toast(`${domain} eliminado`, 'ok');
    setTimeout(loadAll, 800);
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}

// ---------- Utils ----------
function relativeTime(iso) {
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Auto-reload cada 60s
setInterval(() => { if (cfgComplete()) loadAll(); }, 60_000);

loadAll();
