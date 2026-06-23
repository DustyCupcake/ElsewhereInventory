import { initLang, t, renderSwitcher, onLangChange } from './i18n.js?v=1.0.0';

const SUPPORT_EMAIL = '[SUPPORT_EMAIL]';

const qr   = new URLSearchParams(window.location.search).get('qr') ?? '';
const wrap = document.getElementById('it-wrap');

initLang();
renderSwitcher(document.getElementById('lang-switcher'));
onLangChange(renderWithData);

let _data        = null;   // item info
let _history     = null;   // deployment history + active event
let _user        = null;   // logged-in user or null
let _gpsCoords   = null;   // captured lat/lng for log form
let _logPanelOpen = false;

async function boot() {
  if (!qr) {
    _data = { found: false };
    renderWithData();
    return;
  }

  // All three fetches in parallel; history and auth are best-effort
  const [infoRes, historyRes, authRes] = await Promise.allSettled([
    fetch(`/api/item/info?qr=${encodeURIComponent(qr)}`).then(r => r.json()),
    fetch(`/api/items/deployments?qr=${encodeURIComponent(qr)}`).then(r => r.json()),
    fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
  ]);

  _data    = infoRes.status    === 'fulfilled' ? infoRes.value    : { found: false };
  _history = historyRes.status === 'fulfilled' ? historyRes.value : null;
  _user    = authRes.status    === 'fulfilled' ? authRes.value    : null;

  renderWithData();
}

function renderWithData() {
  if (!_data) return;
  const i = (key) => t('item', key);

  document.title = `${i('pageTitle')} — Elsewhere Inventory`;

  if (!_data.found) {
    wrap.innerHTML = `
      <div class="it-not-found">
        <div class="it-not-found-icon">❓</div>
        <div class="it-not-found-title">${esc(i('notFound'))}</div>
        <p>${esc(i('notFoundNote'))}</p>
        <a href="mailto:${esc(resolvedEmail())}" class="it-email">${esc(resolvedEmail())}</a>
      </div>`;
    return;
  }

  const voucherBlock = _data.is_voucher ? `
    <div class="it-voucher-note">
      <div class="it-section-title">💧 ${esc(i('voucherNote'))}</div>
      <a href="/voucher?qr=${encodeURIComponent(qr)}" class="btn primary" style="margin-top:.6rem">
        ${esc(i('checkVoucher'))}
      </a>
    </div>` : '';

  const statusKey   = { out: 'statusOut', available: 'statusIn', retired: 'statusRetired' }[_data.status] ?? 'statusIn';
  const statusLabel = i(statusKey);

  const activeEvent  = _history?.active_event ?? null;
  const deployments  = _history?.deployments ?? [];
  const genPhotos    = _history?.general_photos ?? [];

  // Log-deployment button (only if logged in and there's an active event)
  const logBtnBlock = _user && activeEvent ? `
    <button class="btn primary it-log-btn" id="it-log-open-btn">
      📍 Log deployment — ${esc(activeEvent.name)}
    </button>` : (!_user ? `
    <a href="/login" class="btn it-log-btn">Log in to log deployment</a>` : `
    <div class="it-section" style="text-align:center;color:var(--text3);font-size:13px">
      No active event — ask a production admin to start one.
    </div>`);

  // Deployment history
  const historyBlock = buildHistoryHTML(deployments, genPhotos, i);

  wrap.innerHTML = `
    <div class="it-card">
      <div class="it-icon">📦</div>
      <div class="it-name">${esc(_data.name)}</div>
      <div class="it-type">${esc(_data.type_name)}</div>
      <span class="it-status ${esc(_data.status)}">
        <span class="it-status-dot"></span>
        ${esc(statusLabel)}
      </span>
    </div>

    ${voucherBlock}

    ${logBtnBlock}

    <div id="it-log-panel" style="display:none"></div>

    <div class="it-section">
      <div class="it-section-title">ℹ️</div>
      ${esc(i('systemNote'))}
    </div>

    <div class="it-section">
      <div class="it-section-title">${esc(i('foundTitle'))}</div>
      ${esc(i('foundNote'))}
      <a href="mailto:${esc(resolvedEmail())}" class="it-email">${esc(resolvedEmail())}</a>
    </div>

    ${historyBlock}

    <a href="/login" class="btn">${esc(i('loginBtn'))}</a>
  `;

  // Wire log-deployment button
  document.getElementById('it-log-open-btn')?.addEventListener('click', () => {
    _logPanelOpen = !_logPanelOpen;
    renderLogPanel(activeEvent);
  });

  // Wire photo lightbox
  wrap.addEventListener('click', e => {
    const img = e.target.closest('.it-dep-photo');
    if (!img) return;
    const lb = document.createElement('div');
    lb.className = 'it-lightbox';
    lb.innerHTML = `<img src="${esc(img.src)}" alt="">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  });
}

function buildHistoryHTML(deployments, genPhotos, i) {
  const sections = [];

  // General (non-deployment) photos
  if (genPhotos.length) {
    const thumbs = genPhotos.map(p =>
      `<img class="it-dep-photo" src="/${esc(p.path)}" alt="Item photo" loading="lazy">`
    ).join('');
    sections.push(`
      <div class="it-history-title">Item photos</div>
      <div class="it-dep-card">
        <div class="it-dep-photos">${thumbs}</div>
      </div>`);
  }

  if (!deployments.length) return sections.join('');

  sections.push(`<div class="it-history-title">Deployment history</div>`);

  for (const dep of deployments) {
    const gpsLink = dep.latitude != null ? `
      <a class="it-dep-gps" href="https://maps.google.com/?q=${dep.latitude},${dep.longitude}" target="_blank" rel="noopener">
        📍 ${dep.latitude.toFixed(5)}, ${dep.longitude.toFixed(5)}
      </a><br>` : '';

    const thumbs = dep.photos.map(p =>
      `<img class="it-dep-photo" src="/${esc(p.path)}" alt="Deployment photo" loading="lazy">`
    ).join('');

    const logger = dep.logged_by
      ? `<div class="it-dep-logger">Logged by ${esc(dep.logged_by)}</div>` : '';

    sections.push(`
      <div class="it-dep-card">
        <div class="it-dep-event">${esc(dep.event_name)}</div>
        ${dep.event_date ? `<div class="it-dep-date">${esc(dep.event_date)}</div>` : ''}
        ${dep.notes ? `<div class="it-dep-notes">${esc(dep.notes)}</div>` : ''}
        ${gpsLink}
        ${thumbs ? `<div class="it-dep-photos">${thumbs}</div>` : ''}
        ${logger}
      </div>`);
  }

  return sections.join('');
}

function renderLogPanel(activeEvent) {
  const panel = document.getElementById('it-log-panel');
  const btn   = document.getElementById('it-log-open-btn');
  if (!panel) return;

  if (!_logPanelOpen) {
    panel.style.display = 'none';
    if (btn) btn.textContent = `📍 Log deployment — ${esc(activeEvent.name)}`;
    return;
  }

  if (btn) btn.textContent = 'Cancel';
  panel.style.display = 'block';

  const gpsText = _gpsCoords
    ? `📍 ${_gpsCoords.lat.toFixed(5)}, ${_gpsCoords.lng.toFixed(5)}`
    : 'No location captured';

  panel.innerHTML = `
    <div class="it-log-panel">
      <span class="it-log-event-badge">Logging for: ${esc(activeEvent.name)}</span>

      <label class="it-log-label" for="it-log-notes">Notes — what is this item used for?</label>
      <textarea class="it-log-textarea" id="it-log-notes" placeholder="e.g. Powering the main stage left cluster, run via J-box 4">${esc(_logNotes ?? '')}</textarea>

      <div class="it-log-gps-row">
        <button class="btn" id="it-log-gps-btn">📍 Capture location</button>
        <span id="it-log-gps-status">${esc(gpsText)}</span>
      </div>

      <div class="it-log-photo-row">
        <label class="it-log-label">Photos</label>
        <input type="file" class="it-log-photo-input" id="it-log-photos" accept="image/*" multiple>
      </div>

      <div class="it-log-actions">
        <button class="btn primary" id="it-log-submit-btn">Save</button>
      </div>
      <div id="it-log-msg" style="font-size:13px;margin-top:.6rem;color:var(--text3)"></div>
    </div>`;

  document.getElementById('it-log-gps-btn')?.addEventListener('click', captureGPS);
  document.getElementById('it-log-submit-btn')?.addEventListener('click', submitLog);
}

let _logNotes = '';

async function captureGPS() {
  const btn    = document.getElementById('it-log-gps-btn');
  const status = document.getElementById('it-log-gps-status');
  if (!navigator.geolocation) {
    if (status) status.textContent = 'Geolocation not supported';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Locating…'; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      _gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (status) status.textContent = `📍 ${_gpsCoords.lat.toFixed(5)}, ${_gpsCoords.lng.toFixed(5)}`;
      if (btn) { btn.disabled = false; btn.textContent = '📍 Update location'; }
    },
    () => {
      if (status) status.textContent = 'Location unavailable';
      if (btn) { btn.disabled = false; btn.textContent = '📍 Capture location'; }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function submitLog() {
  const notesEl  = document.getElementById('it-log-notes');
  const photosEl = document.getElementById('it-log-photos');
  const msgEl    = document.getElementById('it-log-msg');
  const submitBtn = document.getElementById('it-log-submit-btn');

  _logNotes = notesEl?.value ?? '';

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

  // Get CSRF token
  let csrf = '';
  try {
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    const me = await meRes.json();
    csrf = me.csrf_token ?? '';
  } catch { /* */ }

  try {
    // 1. Log deployment (upsert)
    const body = { qr, notes: _logNotes };
    if (_gpsCoords) { body.latitude = _gpsCoords.lat; body.longitude = _gpsCoords.lng; }

    const depRes = await fetch('/api/items/deployments', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    });
    const depJson = await depRes.json();
    if (!depRes.ok) throw new Error(depJson.error ?? 'Failed to save deployment');

    const deploymentId = depJson.deployment_id;

    // Resolve item_id from history data (fetched at page load)
    // Refetch history to get item_id and updated data
    const histRes = await fetch(`/api/items/deployments?qr=${encodeURIComponent(qr)}`);
    _history = await histRes.json();

    // Upload any photos using item_id from the history response
    const files  = photosEl?.files ?? [];
    const itemId = _history?.item_id;

    if (files.length && deploymentId && itemId) {
      for (const file of files) {
        const fd = new FormData();
        fd.append('photo', file);
        fd.append('item_id', String(itemId));
        fd.append('deployment_id', String(deploymentId));
        await fetch('/api/items/deployment-photo', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': csrf },
          body: fd,
        });
      }
      // Refetch history to include newly uploaded photos
      const h2 = await fetch(`/api/items/deployments?qr=${encodeURIComponent(qr)}`);
      _history = await h2.json();
    }

    if (msgEl) msgEl.textContent = 'Saved.';
    _logNotes   = '';
    _gpsCoords  = null;
    _logPanelOpen = false;
    renderWithData();

  } catch (err) {
    if (msgEl) msgEl.textContent = 'Error: ' + (err?.message ?? 'unknown error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
  }
}

function resolvedEmail() {
  return SUPPORT_EMAIL === '[SUPPORT_EMAIL]' ? '[SUPPORT_EMAIL]' : SUPPORT_EMAIL;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

boot();
