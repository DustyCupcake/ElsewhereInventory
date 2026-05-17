/**
 * Unified order-independent scanner.
 * Handles checkout sessions, checkin, voucher flows, and info lookups
 * from a single scanning interface.
 *
 * Session state persists across tab switches so a user can navigate away
 * and return without losing scanned items.
 */

import { get, post } from './api.js?v=1.0.1';
import { Scanner } from './scanner.js?v=1.0.0';
import { renderScanResult } from './scan-result.js?v=1.0.0';

// Persistent session state (survives tab switches)
let _session  = null;   // { entity, items, mode }
let _toast    = null;
let _onTabSwitch  = null;
let _updateBanner = null;
let _user     = null;
let _container = null;
let _scanner  = null;   // Scanner instance

export function getSession() { return _session; }

export function destroy() {
  _scanner?.stop();
  _scanner = null;
}

export function init(container, user, { extra = null, onTabSwitch, toast, updateBannerFn } = {}) {
  _container    = container;
  _user         = user;
  _toast        = toast;
  _onTabSwitch  = onTabSwitch;
  _updateBanner = updateBannerFn;

  // Start a fresh session if none exists
  if (!_session) {
    _session = { entity: null, items: [], mode: 'scanning' };
  }

  // Handle extra context passed in (pre-load entity or item from deep link)
  if (extra?.entity) {
    _session.entity = extra.entity;
  }
  if (extra?.mode === 'confirm') {
    _session.mode = 'confirm';
  }
  if (extra?.preload?.qr) {
    // Will be looked up and handled after render
    renderScanning(container);
    handleLookup(extra.preload.qr);
    return;
  }

  renderMode(container);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderMode(container) {
  switch (_session.mode) {
    case 'scanning':    renderScanning(container);    break;
    case 'confirm':     renderConfirm(container);     break;
    case 'entity-select': renderEntitySelect(container); break;
  }
}

function renderScanning(container) {
  const items = _session.items;
  const entity = _session.entity;

  container.innerHTML = `
    <div style="position:relative">
      <div id="scanner-video-wrap" style="position:relative;background:#000;overflow:hidden;border-radius:0">
        <video id="scanner-video" autoplay playsinline muted
          style="width:100%;display:block;max-height:55vh;object-fit:cover"></video>
        <div id="scan-hint" style="position:absolute;bottom:12px;left:0;right:0;text-align:center;
          color:#fff;font-size:13px;text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none">
          ${entity ? `Scanning items for <strong>${esc(entity.name)}</strong>` : 'Scan any QR code'}
        </div>
      </div>

      <div style="padding:1rem">
        ${items.length > 0 ? `
          <div style="margin-bottom:.75rem">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:.4rem">
              ${items.length} item${items.length !== 1 ? 's' : ''} scanned
            </div>
            ${items.map((it, i) => `
              <div style="display:flex;align-items:center;justify-content:space-between;
                padding:.4rem 0;border-bottom:0.5px solid var(--border);font-size:14px">
                <span>${esc(it.name)}</span>
                <button onclick="window._scanner.removeItem(${i})"
                  style="background:none;border:none;color:var(--text3);cursor:pointer;
                  font-size:16px;padding:0 4px">×</button>
              </div>`).join('')}
          </div>` : ''}

        <div style="display:flex;gap:.5rem;margin-bottom:.75rem">
          <input id="manual-qr-input" type="text" placeholder="Or type / paste a code…"
            style="flex:1" autocomplete="off" autocorrect="off" spellcheck="false">
          <button class="btn" onclick="window._scanner.manualSubmit()">Go</button>
        </div>

        ${!entity ? `
          <button class="btn" style="width:100%;margin-bottom:.5rem"
            onclick="window._scanner.goEntitySelect()">
            Choose recipient manually
          </button>` : ''}

        ${items.length > 0 ? `
          <button class="btn primary" style="width:100%"
            onclick="window._scanner.done()">
            Done scanning →
          </button>` : ''}
      </div>
    </div>

    <div id="scan-result-overlay" style="display:none;position:fixed;inset:0;z-index:40;
      background:var(--bg);overflow-y:auto;padding:1rem 1rem 3rem">
      <button onclick="window._scanner.closeOverlay()"
        style="background:none;border:none;font-size:22px;color:var(--text2);
        cursor:pointer;margin-bottom:.5rem">←</button>
      <div id="scan-result-inner"></div>
    </div>`;

  window._scanner = {
    removeItem: (i) => { _session.items.splice(i, 1); _updateBanner(); renderMode(_container); },
    manualSubmit: () => {
      const val = document.getElementById('manual-qr-input')?.value.trim();
      if (val) handleLookup(val);
    },
    goEntitySelect: () => { _session.mode = 'entity-select'; renderMode(_container); },
    done: () => {
      if (!_session.entity) { _session.mode = 'entity-select'; renderMode(_container); }
      else { _session.mode = 'confirm'; renderMode(_container); }
    },
    closeOverlay: () => {
      document.getElementById('scan-result-overlay').style.display = 'none';
      resumeCamera();
    },
  };

  document.getElementById('manual-qr-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') window._scanner.manualSubmit();
  });

  startCamera();
}

function renderConfirm(container) {
  const { entity, items } = _session;

  if (!entity) {
    _session.mode = 'entity-select';
    renderMode(container);
    return;
  }
  if (items.length === 0) {
    _session.mode = 'scanning';
    renderMode(container);
    return;
  }

  container.innerHTML = `
    <div style="padding:1rem">
      <div style="font-size:17px;font-family:'Georgia',serif;margin-bottom:1rem">
        Lend to <strong>${esc(entity.name)}</strong>
      </div>

      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;
        color:var(--text3);margin-bottom:.4rem">${items.length} item${items.length !== 1 ? 's' : ''}</div>
      <div style="background:var(--surface);border:0.5px solid var(--border-med);
        border-radius:var(--radius);margin-bottom:1rem">
        ${items.map(it => `
          <div style="display:flex;justify-content:space-between;padding:.6rem .75rem;
            border-bottom:0.5px solid var(--border);font-size:14px">
            <span>${esc(it.name)}</span>
            <span style="color:var(--text3);font-size:12px">${esc(it.qr)}</span>
          </div>`).join('')}
      </div>

      <button class="btn primary" style="width:100%;margin-bottom:.5rem"
        id="confirm-lend-btn">Confirm lend</button>
      <button class="btn" style="width:100%"
        onclick="window._scanner.backToScan()">← Back to scanning</button>
    </div>`;

  window._scanner = { backToScan: () => { _session.mode = 'scanning'; renderMode(_container); } };

  document.getElementById('confirm-lend-btn')?.addEventListener('click', submitCheckout);
}

function renderEntitySelect(container) {
  container.innerHTML = `
    <div style="padding:1rem">
      <div style="font-size:17px;font-family:'Georgia',serif;margin-bottom:1rem">
        Who are you lending to?
      </div>

      <input id="entity-search" type="text" placeholder="Search barrio or person…"
        style="width:100%;margin-bottom:.5rem" autocomplete="off">
      <div id="entity-results"></div>

      <div style="margin-top:1rem;font-size:12px;text-transform:uppercase;
        letter-spacing:.07em;color:var(--text3);margin-bottom:.4rem">Or scan their QR</div>
      <button class="btn" style="width:100%" id="entity-scan-btn">Open scanner</button>

      <div style="margin-top:.75rem">
        <button class="btn ghost" onclick="window._scanner.backToScan()">← Cancel</button>
      </div>
    </div>`;

  window._scanner = { backToScan: () => { _session.mode = 'scanning'; renderMode(_container); } };

  let searchTimer;
  document.getElementById('entity-search')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { document.getElementById('entity-results').innerHTML = ''; return; }
    searchTimer = setTimeout(() => searchEntities(q), 300);
  });

  document.getElementById('entity-scan-btn')?.addEventListener('click', () => {
    _session.mode = 'scanning';
    renderMode(_container);
  });
}

async function searchEntities(q) {
  const results = document.getElementById('entity-results');
  if (!results) return;

  const perms = _user?.permissions || [];
  const matches = [];

  try {
    if (perms.includes('sub_checkout') || perms.includes('checkout_equipment')) {
      // Search barrios
      const barrios = JSON.parse(localStorage.getItem('barrio_camps') || '[]');
      barrios.filter(b => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5).forEach(b => {
        matches.push({ type: 'barrio', id: b.id, name: b.name });
      });
    }
    if (perms.includes('person_checkout') || perms.includes('sub_checkout')) {
      const data = await get('/persons?q=' + encodeURIComponent(q));
      (data.persons || []).slice(0, 5).forEach(p => {
        matches.push({ type: 'person', id: p.id, name: p.display_name, qr: p.qr_token });
      });
    }
  } catch {}

  if (!matches.length) {
    results.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:.5rem 0">No results</div>';
    return;
  }

  results.innerHTML = matches.map((m, i) => `
    <button data-idx="${i}" style="display:flex;align-items:center;gap:.5rem;width:100%;
      padding:.5rem .25rem;background:none;border:none;border-bottom:0.5px solid var(--border);
      text-align:left;cursor:pointer;font-size:14px;color:var(--text)">
      <span style="font-size:1rem">${m.type === 'barrio' ? '⛺' : '👤'}</span>
      ${esc(m.name)}
    </button>`).join('');

  results.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = matches[+btn.dataset.idx];
      _session.entity = m;
      if (_session.items.length > 0) {
        _session.mode = 'confirm';
      } else {
        _session.mode = 'scanning';
      }
      _updateBanner();
      renderMode(_container);
    });
  });
}

// ── Camera ────────────────────────────────────────────────────────────────────

function startCamera() {
  const video = document.getElementById('scanner-video');
  if (!video) return;
  _scanner?.stop();
  _scanner = new Scanner(video, qr => handleLookup(qr));
  _scanner.start().catch(err => {
    const hint = document.getElementById('scan-hint');
    if (hint) hint.textContent = 'Camera unavailable — use manual entry below';
  });
}

function resumeCamera() {
  // Scanner stops itself after emitting; restart for next scan
  const video = document.getElementById('scanner-video');
  if (!video) return;
  _scanner = new Scanner(video, qr => handleLookup(qr));
  _scanner.start().catch(() => {});
}

// ── QR Lookup & Routing ───────────────────────────────────────────────────────

async function handleLookup(qr) {
  // Scanner already stopped itself on emit; overlay takes focus
  const overlay = document.getElementById('scan-result-overlay');
  const inner   = document.getElementById('scan-result-inner');
  if (!overlay || !inner) return;

  inner.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  overlay.style.display = '';

  let data;
  try {
    data = await get('/scan/lookup?qr=' + encodeURIComponent(qr));
  } catch (e) {
    inner.innerHTML = `<div style="color:var(--text2);padding:1rem">Error: ${esc(e.message)}</div>`;
    return;
  }

  const perms = _user?.permissions || [];

  // If scanned in mid-checkout and got a voucher — warn
  if (data.type === 'item' && data.is_voucher && _session.items.length > 0) {
    inner.innerHTML = `
      <div class="scan-card">
        <div class="scan-card-icon">⚠️</div>
        <div class="scan-card-body">
          <div class="scan-card-name">Voucher scanned mid-checkout</div>
          <div class="scan-card-sub">Handle this voucher separately or continue your checkout.</div>
        </div>
      </div>
      <div class="scan-actions">
        <button class="btn primary scan-action-btn" id="handle-voucher-btn">Handle voucher</button>
        <button class="btn scan-action-btn" onclick="window._scanner.closeOverlay()">Continue checkout</button>
      </div>`;
    document.getElementById('handle-voucher-btn')?.addEventListener('click', () => {
      _session = { entity: null, items: [], mode: 'scanning' };
      handleLookup(qr);
    });
    return;
  }

  renderScanResult(inner, data, perms, (action, payload) => {
    onScanAction(action, payload, qr, data);
  });
}

async function onScanAction(action, payload, rawQr, lookupData) {
  const overlay = document.getElementById('scan-result-overlay');
  const perms   = _user?.permissions || [];

  switch (action) {
    case 'entity_select': {
      // Entity QR scanned — set as checkout target
      let entity = null;
      if (lookupData.type === 'barrio') {
        entity = { type: 'barrio', id: lookupData.id, name: lookupData.name };
      } else if (lookupData.type === 'department') {
        entity = { type: 'dept', id: lookupData.id, name: lookupData.name };
      } else if (lookupData.type === 'person') {
        entity = { type: 'person', id: lookupData.id, name: lookupData.name, qr: rawQr };
      }

      if (_session.entity && _session.entity.id !== entity?.id) {
        // Switching entity mid-session
        const inner = document.getElementById('scan-result-inner');
        inner.innerHTML = `
          <div class="scan-card">
            <div class="scan-card-icon">⚠️</div>
            <div class="scan-card-body">
              <div class="scan-card-name">Switch recipient?</div>
              <div class="scan-card-sub">
                Currently lending to <strong>${esc(_session.entity.name)}</strong>.
                Switch to <strong>${esc(entity.name)}</strong>?
                Your scanned items will be kept.
              </div>
            </div>
          </div>
          <div class="scan-actions">
            <button class="btn primary scan-action-btn" id="switch-entity-btn">Switch to ${esc(entity.name)}</button>
            <button class="btn scan-action-btn" onclick="window._scanner.closeOverlay()">Keep ${esc(_session.entity.name)}</button>
          </div>`;
        document.getElementById('switch-entity-btn')?.addEventListener('click', () => {
          _session.entity = entity;
          _updateBanner();
          overlay.style.display = 'none';
          renderMode(_container);
        });
        return;
      }

      if (entity) {
        _session.entity = entity;
        _updateBanner();
      }
      overlay.style.display = 'none';
      renderMode(_container);
      break;
    }

    case 'checkout_start': {
      // Available item scanned — add to items list
      if (_session.items.some(i => i.qr === rawQr)) {
        _toast('Already in list');
        overlay.style.display = 'none';
        resumeCamera();
        return;
      }
      _session.items.push({ qr: rawQr, name: lookupData.name, id: lookupData.id });
      _updateBanner();
      overlay.style.display = 'none';
      renderMode(_container);
      break;
    }

    case 'borrow_self': {
      await doAction(() => post('/person-checkout', {
        person_qr: _user.qr_token,
        item_qrs: [rawQr],
      }), 'Borrowed');
      overlay.style.display = 'none';
      resumeCamera();
      break;
    }

    case 'checkin': {
      await doAction(() => post('/checkin', { item_qrs: [rawQr] }), 'Returned');
      overlay.style.display = 'none';
      resumeCamera();
      break;
    }

    case 'activate': {
      await doAction(() => post('/items/activate', { qr: rawQr }), 'Activated');
      overlay.style.display = 'none';
      resumeCamera();
      break;
    }

    case 'validate': {
      await doAction(() => post('/items/use', { qr: rawQr }), 'Validated');
      overlay.style.display = 'none';
      resumeCamera();
      break;
    }
  }
}

async function doAction(apiFn, successMsg) {
  try {
    const result = await apiFn();
    _toast(result.error ? ('Error: ' + result.error) : successMsg);
  } catch (e) {
    _toast('Error: ' + e.message);
  }
}

// ── Submit checkout ───────────────────────────────────────────────────────────

async function submitCheckout() {
  const { entity, items } = _session;
  if (!entity || items.length === 0) return;

  const btn = document.getElementById('confirm-lend-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Lending…'; }

  const item_qrs = items.map(i => i.qr);
  const perms    = _user?.permissions || [];

  try {
    let endpoint, body;

    if (entity.type === 'person') {
      endpoint = perms.includes('checkout_equipment') ? '/person-checkout' : '/sub-person-checkout';
      body = { person_qr: entity.qr, item_qrs };
      if (entity.type === 'person' && !perms.includes('checkout_equipment')) {
        body.dept_id = _user?.dept_ids?.[0];
      }
    } else if (entity.type === 'dept') {
      endpoint = '/checkout';
      body = { dept_id: entity.id, item_qrs };
    } else if (entity.type === 'barrio') {
      endpoint = '/sub-checkout';
      body = { barrio_id: entity.id, item_qrs };
    } else if (entity.type === 'artist') {
      endpoint = '/sub-checkout';
      body = { artist_id: entity.id, item_qrs };
    }

    const result = await post(endpoint, body);
    if (result.error) throw new Error(result.error);

    _toast('Lent successfully');
    _session = null;
    _updateBanner();
    _onTabSwitch('home');
  } catch (e) {
    _toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm lend'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
