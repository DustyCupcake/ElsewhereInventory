/**
 * Truck crew fill route page.
 * Requires fill_truck permission (shift QR session or production_admin).
 *
 * Flow:
 *   1. Auth check — redirect to login if missing fill_truck permission
 *   2. Direction picker — claim CW or CCW from the server; locks out the other truck
 *   3. Route list — ordered stops with tap-to-fill and scan-to-fill
 *   4. Next-stop banner — always visible above scan buttons; tap to see full progress
 *   5. Out-of-order warning — shown when a scanned cube isn't the expected next stop
 */

import { Scanner } from './scanner.js?v=1.0.0';

const CLAIM_KEY = 'fill_claim_id';

let csrfToken    = null;
let direction    = null;
let claimId      = null;
let scanner      = null;

// ── Stop state ──────────────────────────────────────────────────────────────
// stops        — current server-side pending stops (shrinks as fills confirmed)
// allStops     — full union for progress display (never shrinks)
// stopStatuses — Map<cube_qr, 'pending'|'filled'|'skipped'>
let stops        = [];
let allStops     = [];
let stopStatuses = new Map();

function initStopStatuses(newStops) {
  newStops.forEach(s => {
    if (!allStops.find(a => a.cube_qr === s.cube_qr)) allStops.push(s);
    if (!stopStatuses.has(s.cube_qr)) stopStatuses.set(s.cube_qr, 'pending');
  });
  // Stops that were pending but no longer in the server response were filled
  allStops.forEach(s => {
    if (!newStops.find(n => n.cube_qr === s.cube_qr) &&
        stopStatuses.get(s.cube_qr) === 'pending') {
      stopStatuses.set(s.cube_qr, 'filled');
    }
  });
}

function getNextStop() {
  return stops.find(s => stopStatuses.get(s.cube_qr) === 'pending') ?? null;
}

function getNextStopIndex() {
  return stops.findIndex(s => stopStatuses.get(s.cube_qr) === 'pending');
}

function pendingCount()  { return [...stopStatuses.values()].filter(v => v === 'pending').length; }
function filledCount()   { return [...stopStatuses.values()].filter(v => v === 'filled').length; }
function skippedCount()  { return [...stopStatuses.values()].filter(v => v === 'skipped').length; }

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const res  = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) throw new Error();
    const user = await res.json();
    csrfToken  = user.csrf_token;
    if (!user.permissions?.includes('fill_truck')) {
      document.getElementById('fr-body').innerHTML =
        '<div class="fr-empty">You need <b>fill_truck</b> permission to access this page.</div>';
      return;
    }
  } catch {
    window.location.href = '/login.html?next=' + encodeURIComponent(location.pathname);
    return;
  }

  document.getElementById('fr-logout-btn').onclick = doLogout;
  document.getElementById('fr-scan-btn').onclick   = () => openScanModal('confirm');
  document.getElementById('fr-adhoc-btn').onclick  = () => openScanModal('adhoc');
  document.getElementById('fr-next-banner').onclick = showProgressOverlay;
  document.getElementById('fr-progress-close').onclick = hideProgressOverlay;

  // Restore saved direction claim
  const saved = localStorage.getItem(CLAIM_KEY);
  if (saved) {
    try { const p = JSON.parse(saved); claimId = p.id; direction = p.direction; } catch {}
  }

  if (direction) {
    applyDirection(direction);
    await loadRoute();
  } else {
    await showDirectionPicker();
  }
}

// ── Direction picker ──────────────────────────────────────────────────────────

async function showDirectionPicker() {
  const overlay = document.getElementById('fr-direction-overlay');
  overlay.style.display = 'flex';
  document.getElementById('fr-scan-bar').style.display  = 'none';
  document.getElementById('fr-next-banner').style.display = 'none';
  document.getElementById('fr-body').innerHTML = '';

  const claimedByMap = {};
  try {
    const res  = await apiFetch('/api/fill/direction-status');
    const data = await res.json();
    (data.claims || []).forEach(c => { claimedByMap[c.direction] = c.user_name; });
  } catch {}

  const ascTaken  = 'asc'  in claimedByMap;
  const descTaken = 'desc' in claimedByMap;

  overlay.innerHTML = `
    <div class="fr-pick-title">Choose your route direction</div>
    <div class="fr-pick-sub">Pick the direction your truck will travel today.</div>
    <div class="fr-dir-cards">
      <div class="fr-dir-card ${ascTaken ? 'taken' : ''}" data-dir="asc">
        <div class="fr-dir-card-icon">→</div>
        <div class="fr-dir-card-label">Clockwise</div>
        <div class="fr-dir-card-desc">Route A → Z<br>Low stop numbers first</div>
        ${ascTaken ? `<div class="fr-dir-card-taken">Taken by ${escHtml(claimedByMap.asc ?? 'other crew')}</div>` : ''}
      </div>
      <div class="fr-dir-card ${descTaken ? 'taken' : ''}" data-dir="desc">
        <div class="fr-dir-card-icon">←</div>
        <div class="fr-dir-card-label">Counterclockwise</div>
        <div class="fr-dir-card-desc">Route Z → A<br>High stop numbers first</div>
        ${descTaken ? `<div class="fr-dir-card-taken">Taken by ${escHtml(claimedByMap.desc ?? 'other crew')}</div>` : ''}
      </div>
    </div>
  `;

  overlay.querySelectorAll('.fr-dir-card:not(.taken)').forEach(card => {
    card.addEventListener('click', () => claimDirection(card.dataset.dir));
  });
}

async function claimDirection(dir) {
  const overlay = document.getElementById('fr-direction-overlay');
  overlay.innerHTML = `<div class="fr-pick-title">Starting ${dir === 'asc' ? 'Clockwise →' : '← Counterclockwise'} route…</div>`;

  try {
    const res  = await apiFetch('/api/fill/claim-direction', 'POST', { direction: dir });
    const data = await res.json();
    if (!res.ok) { await showDirectionPicker(); return; }

    claimId   = data.claim_id;
    direction = dir;
    localStorage.setItem(CLAIM_KEY, JSON.stringify({ id: claimId, direction }));

    overlay.style.display = 'none';
    document.getElementById('fr-scan-bar').style.display = '';
    applyDirection(direction);
    await loadRoute();
  } catch {
    overlay.innerHTML = `
      <div class="fr-pick-title">Network error</div>
      <div class="fr-pick-sub">Could not claim direction — check connection.</div>
      <button class="btn" onclick="location.reload()">Retry</button>
    `;
  }
}

function applyDirection(dir) {
  direction = dir;
  document.getElementById('dir-asc') ?.classList.toggle('active', dir === 'asc');
  document.getElementById('dir-desc')?.classList.toggle('active', dir === 'desc');
}

// ── Route loading ─────────────────────────────────────────────────────────────

async function loadRoute() {
  const body = document.getElementById('fr-body');
  if (!stops.length) body.innerHTML = '<div class="fr-empty">Loading route…</div>';

  try {
    const res  = await apiFetch(`/api/fill-route?direction=${direction}`);
    const data = await res.json();
    stops = data.stops || [];
    initStopStatuses(stops);
    renderRoute();
    renderNextStopBanner();
  } catch {
    body.innerHTML = '<div class="fr-empty">Failed to load route — check connection.</div>';
  }
}

// ── Route list ────────────────────────────────────────────────────────────────

function renderRoute() {
  const body = document.getElementById('fr-body');

  if (stops.length === 0 && allStops.length === 0) {
    body.innerHTML = `
      <div class="fr-empty">
        No pending fill requests on the ${direction === 'asc' ? 'clockwise →' : '← counterclockwise'} route.
      </div>`;
    return;
  }

  if (stops.length === 0) {
    body.innerHTML = '<div class="fr-empty">All stops on this route are complete.</div>';
    return;
  }

  body.innerHTML = stops.map((s, i) => {
    const status = stopStatuses.get(s.cube_qr) ?? 'pending';
    const isNext = i === getNextStopIndex();
    const rowClass = status === 'skipped' ? 'fr-stop skipped-stop' : `fr-stop${isNext ? ' next-stop' : ''}`;
    return `
      <div class="${rowClass}" data-qr="${escAttr(s.cube_qr)}" data-index="${i}"
           style="${status === 'skipped' ? 'opacity:.4;' : ''}">
        <div class="fr-stop-pos" style="${isNext ? 'background:var(--accent);color:#fff;' : ''}">
          ${s.route_position ?? '?'}
        </div>
        <div class="fr-stop-info">
          <div class="fr-stop-entity">${escHtml(s.entity_name)}</div>
          <div class="fr-stop-cube">${escHtml(s.cube_label)}</div>
          <div class="fr-stop-fills">${s.fills_remaining} fill${s.fills_remaining !== 1 ? 's' : ''} requested</div>
        </div>
        <div class="fr-stop-actions">
          <button class="fr-fill-btn" data-qr="${escAttr(s.cube_qr)}" data-index="${i}"
            ${status === 'skipped' ? 'disabled style="opacity:.4"' : ''}>Fill ✓</button>
          <button class="fr-skip-btn" data-qr="${escAttr(s.cube_qr)}" data-index="${i}"
            ${status === 'skipped' ? 'style="display:none"' : ''}>Skip</button>
        </div>
      </div>
    `;
  }).join('');

  body.querySelectorAll('.fr-fill-btn:not([disabled])').forEach(btn => {
    btn.onclick = () => confirmFillByQr(btn.dataset.qr, +btn.dataset.index, 'tap');
  });
  body.querySelectorAll('.fr-skip-btn').forEach(btn => {
    btn.onclick = () => skipStop(btn.dataset.qr, +btn.dataset.index);
  });
}

// ── Next-stop banner ──────────────────────────────────────────────────────────

function renderNextStopBanner() {
  const banner  = document.getElementById('fr-next-banner');
  const nameEl  = document.getElementById('fr-next-banner-stop');
  const metaEl  = document.getElementById('fr-next-banner-meta');

  const next = getNextStop();
  if (!next || stops.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  nameEl.textContent = next.entity_name;
  metaEl.textContent = `Stop #${next.route_position ?? '?'} · ${next.cube_label}`;
}

// ── Progress overlay ──────────────────────────────────────────────────────────

function showProgressOverlay() {
  const overlay = document.getElementById('fr-progress-overlay');
  const list    = document.getElementById('fr-progress-list');
  const title   = document.getElementById('fr-progress-title');
  const sub     = document.getElementById('fr-progress-sub');

  const filled  = filledCount();
  const pending = pendingCount();
  const skipped = skippedCount();
  const total   = allStops.length;

  title.textContent = `Route progress — ${direction === 'asc' ? 'Clockwise →' : '← Counterclockwise'}`;
  sub.textContent   = `${filled} filled · ${pending} remaining · ${skipped ? `${skipped} skipped` : ''}`;

  const nextQr  = getNextStop()?.cube_qr;

  // Sort allStops by route_position (ASC or DESC depending on direction)
  const sorted = [...allStops].sort((a, b) =>
    direction === 'asc'
      ? (a.route_position ?? 9999) - (b.route_position ?? 9999)
      : (b.route_position ?? -1)  - (a.route_position ?? -1)
  );

  list.innerHTML = sorted.map(s => {
    const status  = stopStatuses.get(s.cube_qr) ?? 'pending';
    const isNext  = s.cube_qr === nextQr;
    const badgeClass = status === 'filled' ? 'filled'
      : status === 'skipped'              ? 'skipped'
      : isNext                            ? 'next'
      :                                     'upcoming';
    const badgeContent = status === 'filled'  ? '✓'
      : status === 'skipped'                  ? '↷'
      : isNext                                ? '→'
      :                                         String(s.route_position ?? '?');

    const tag = isNext   ? '<span class="fr-progress-stop-tag next">Next</span>'
      : status === 'skipped' ? '<span class="fr-progress-stop-tag skipped">Skipped</span>'
      : '';

    return `
      <div class="fr-progress-stop">
        <div class="fr-progress-badge ${badgeClass}">${badgeContent}</div>
        <div class="fr-progress-stop-info">
          <div class="fr-progress-stop-entity ${status}">${escHtml(s.entity_name)}</div>
          <div class="fr-progress-stop-cube">${escHtml(s.cube_label)}</div>
        </div>
        ${tag}
      </div>
    `;
  }).join('') || '<div style="color:var(--text3);text-align:center;padding:2rem 0;font-size:14px">No stops recorded yet</div>';

  overlay.style.display = 'flex';
}

function hideProgressOverlay() {
  document.getElementById('fr-progress-overlay').style.display = 'none';
}

// ── Confirm fill ──────────────────────────────────────────────────────────────

async function confirmFillByQr(cube_qr, indexHint, source = 'scan') {
  // Find this stop in the current list
  const idx = indexHint !== null && indexHint !== undefined && stops[indexHint]?.cube_qr === cube_qr
    ? indexHint
    : stops.findIndex(s => s.cube_qr === cube_qr);

  if (idx === -1) {
    // Not in pending list — could be a cube with no request
    showScanError('No pending fill request for this cube.');
    return;
  }

  const nextIdx = getNextStopIndex();

  // Out-of-order check — only warn if there's a clearly different expected next stop
  if (nextIdx !== -1 && idx !== nextIdx) {
    showOutOfOrderWarning(cube_qr, idx, nextIdx);
    return;
  }

  await doConfirmFill(cube_qr, idx);
}

async function doConfirmFill(cube_qr, idx) {
  try {
    const res  = await apiFetch('/api/fill/confirm', 'POST', { cube_qr });
    const data = await res.json();

    if (res.ok && data.success) {
      stopStatuses.set(cube_qr, 'filled');
      markStopDone(idx);
      showFillSuccess(data.cube_label, data.entity_name, data.fills_remaining);
    } else {
      showScanError(data.error || 'Could not confirm fill.');
    }
  } catch {
    showScanError('Network error — try again.');
  }
}

function markStopDone(index) {
  stops.splice(index, 1);
  // Brief fade before re-render gives visual feedback
  const el = document.querySelector(`.fr-stop[data-index="${index}"]`);
  if (el) {
    el.classList.add('completing');
    setTimeout(() => { renderRoute(); renderNextStopBanner(); }, 350);
  } else {
    renderRoute();
    renderNextStopBanner();
  }
}

function skipStop(cube_qr, _index) {
  stopStatuses.set(cube_qr, 'skipped');
  renderRoute();
  renderNextStopBanner();
}

// ── Out-of-order warning ──────────────────────────────────────────────────────

function showOutOfOrderWarning(cube_qr, scannedIdx, nextIdx) {
  const scanned = stops[scannedIdx];
  const next    = stops[nextIdx];
  const skipCount = scannedIdx - nextIdx;

  const modal = document.getElementById('fr-scan-modal');
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fr-scan-modal-inner">
      <div class="fr-scan-modal-title">Stop out of order</div>
      <div class="fr-adhoc-card">
        <div class="fr-adhoc-card-title">Not the expected next stop</div>
        <div class="fr-adhoc-card-body">
          You scanned <b>stop #${scanned.route_position ?? '?'} — ${escHtml(scanned.entity_name)}</b>.<br>
          Expected next was <b>stop #${next.route_position ?? '?'} — ${escHtml(next.entity_name)}</b>.
          ${skipCount > 0
            ? `<br><br>${skipCount} stop${skipCount !== 1 ? 's' : ''} before this one will be marked as skipped.`
            : ''}
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.75rem">
        <button class="btn" id="ooo-confirm-btn">Fill anyway</button>
        <button class="btn secondary" id="ooo-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('ooo-cancel-btn').onclick = () => {
    modal.style.display = 'none';
    modal.innerHTML = '';
  };

  document.getElementById('ooo-confirm-btn').onclick = async () => {
    modal.style.display = 'none';
    modal.innerHTML = '';

    // Mark everything between nextIdx and scannedIdx as skipped (batch, single re-render)
    for (let i = nextIdx; i < scannedIdx; i++) {
      const s = stops[i];
      if (s && stopStatuses.get(s.cube_qr) === 'pending') {
        stopStatuses.set(s.cube_qr, 'skipped');
      }
    }
    renderRoute();
    renderNextStopBanner();
    await doConfirmFill(cube_qr, scannedIdx);
  };
}

// ── Ad-hoc fill (sticker fallback) ────────────────────────────────────────────

async function confirmAdhocByQr(cube_qr) {
  const modal = document.getElementById('fr-scan-modal');
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fr-scan-modal-inner">
      <div class="fr-scan-modal-title">Confirm sticker fill</div>
      <div class="fr-adhoc-card">
        <div class="fr-adhoc-card-title">No digital request</div>
        <div class="fr-adhoc-card-body">
          Confirming a fill with no pending digital request — use when a sticker is
          present but no request was created in the app. A credit will be used if available.
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:.75rem">
        Cube: <b id="adhoc-cube-label">looking up…</b>
      </div>
      <textarea id="adhoc-notes" placeholder="Optional notes (sticker colour, reason…)"
        style="width:100%;height:60px;padding:8px;font-family:Georgia,serif;font-size:13px;
               border:0.5px solid var(--border-med);border-radius:var(--radius);
               background:var(--surface);color:var(--text);resize:none"></textarea>
      <div style="display:flex;gap:.5rem;margin-top:.75rem">
        <button class="btn" id="adhoc-confirm-btn">Confirm fill</button>
        <button class="btn secondary" id="adhoc-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  try {
    const r = await fetch(`/api/water/cube-status?qr=${encodeURIComponent(cube_qr)}`);
    const d = await r.json();
    const lbl = document.getElementById('adhoc-cube-label');
    if (lbl) lbl.textContent = d.cube_label ?? cube_qr;
  } catch {}

  document.getElementById('adhoc-cancel-btn').onclick = closeScanModal;
  document.getElementById('adhoc-confirm-btn').onclick = async () => {
    const notes = document.getElementById('adhoc-notes')?.value?.trim() ?? '';
    try {
      const res  = await apiFetch('/api/fill/confirm-adhoc', 'POST', { cube_qr, notes });
      const data = await res.json();
      if (res.ok && data.success) {
        closeScanModal();
        showFillSuccess(data.cube_label, data.entity_name, null, true);
        loadRoute();
      } else {
        showScanError(data.error || 'Could not confirm fill.');
      }
    } catch {
      showScanError('Network error.');
    }
  };
}

// ── Scanner modal ─────────────────────────────────────────────────────────────

function openScanModal(mode) {
  const modal = document.getElementById('fr-scan-modal');
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fr-scan-modal-inner">
      <div class="fr-scan-modal-title">${mode === 'adhoc' ? 'Scan cube (sticker fill)' : 'Scan cube to confirm fill'}</div>
      <div class="fr-scan-video-wrap">
        <video id="fr-scan-video" playsinline muted></video>
        <div class="fr-scan-overlay">
          <div class="fr-scan-frame"><div class="fr-scan-line"></div></div>
        </div>
      </div>
      <div class="fr-scan-status" id="fr-scan-status">Aim camera at the cube QR code</div>
      <button class="btn secondary" id="fr-scan-close" style="margin-top:.5rem">Cancel</button>
    </div>
  `;
  document.getElementById('fr-scan-close').onclick = closeScanModal;

  const video = document.getElementById('fr-scan-video');
  scanner = new Scanner(video, (qr) => {
    closeScanModal(false);
    if (mode === 'adhoc') confirmAdhocByQr(qr);
    else confirmFillByQr(qr, null, 'scan');
  });
  scanner.start().catch(() => {
    const s = document.getElementById('fr-scan-status');
    if (s) s.textContent = 'Camera unavailable';
  });
}

function closeScanModal(clearScanner = true) {
  if (clearScanner && scanner) { scanner.stop(); scanner = null; }
  const modal = document.getElementById('fr-scan-modal');
  modal.style.display = 'none';
  modal.innerHTML = '';
}

// ── Logout ────────────────────────────────────────────────────────────────────

async function doLogout() {
  if (claimId) {
    try { await apiFetch('/api/fill/release-direction', 'POST', { claim_id: claimId }); } catch {}
    localStorage.removeItem(CLAIM_KEY);
  }
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html';
}

// ── Feedback ──────────────────────────────────────────────────────────────────

function showFillSuccess(cubeLabel, entityName, fillsRemaining, isAdhoc = false) {
  const body = document.getElementById('fr-body');
  const el   = document.createElement('div');
  el.className = 'fr-confirm-card';
  el.innerHTML = `
    <div class="fr-confirm-card-title">${isAdhoc ? 'Ad-hoc fill logged' : 'Fill confirmed ✓'}</div>
    <div class="fr-confirm-card-body">
      ${escHtml(cubeLabel)} — ${escHtml(entityName ?? '—')}
      ${fillsRemaining !== null && fillsRemaining !== undefined
        ? `<br>${fillsRemaining} fill${fillsRemaining !== 1 ? 's' : ''} remaining for this entity`
        : ''}
    </div>
  `;
  body.prepend(el);
  setTimeout(() => el.remove(), 4000);
}

function showScanError(msg) {
  const stat = document.getElementById('fr-scan-status');
  if (stat) {
    stat.textContent  = msg;
    stat.style.color  = 'var(--warn)';
    setTimeout(() => { stat.style.color = ''; stat.textContent = 'Aim camera at the cube QR code'; }, 3000);
    return;
  }
  const body = document.getElementById('fr-body');
  const el   = document.createElement('div');
  el.style.cssText = 'background:var(--warn-bg);border:0.5px solid var(--warn-border);border-radius:var(--radius-lg);padding:.75rem 1rem;margin-bottom:.75rem;font-size:13px;color:var(--warn)';
  el.textContent = msg;
  body.prepend(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, credentials: 'include', headers: { 'X-CSRF-Token': csrfToken || '' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(path, opts);
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(str) { return String(str ?? '').replace(/"/g, '&quot;'); }

boot();
