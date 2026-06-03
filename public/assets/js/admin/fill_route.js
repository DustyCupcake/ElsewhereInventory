/**
 * Admin: Fill Route section.
 * Drag-and-drop ordering of water cube stops and credit management.
 */

import { get, put } from '../api.js?v=1.0.1';

let _toast;
let _onRoute  = [];   // cubes with route_position, sorted
let _offRoute = [];   // cubes with no route_position
let _dirty    = false;

export async function initFillRoute(container, toast) {
  _toast = toast;
  renderShell(container);
  await load();
  renderLists();
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function renderShell(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Fill Route</div>
        <div class="page-subtitle">Drag cubes to set the circular route order. The truck crew will see stops in this sequence.</div>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <button class="btn primary sm" id="fr-save-btn" style="display:none" onclick="window._fr.save()">Save route</button>
        <button class="btn sm" onclick="window._fr.reload()">Refresh</button>
      </div>
    </div>

    <div id="fr-status" style="margin-bottom:1rem"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;align-items:start">
      <div>
        <div class="section-label" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:.6rem">
          On route <span id="fr-on-count" style="color:var(--text2)"></span>
        </div>
        <div id="fr-on-list" class="fr-drop-zone"></div>
      </div>
      <div>
        <div class="section-label" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:.6rem">
          Not on route
        </div>
        <div id="fr-off-list" class="fr-drop-zone fr-off-zone">
          <div class="fr-drop-placeholder" style="display:none">Drop here to remove from route</div>
        </div>
      </div>
    </div>

    <style>
      .fr-drop-zone {
        min-height: 80px;
        border: 1.5px dashed var(--border);
        border-radius: var(--radius-lg);
        padding: .5rem;
        transition: border-color .15s, background .15s;
      }
      .fr-drop-zone.drag-over {
        border-color: var(--accent);
        background: var(--accent-light);
      }
      .fr-item {
        background: var(--surface);
        border: 0.5px solid var(--border);
        border-radius: var(--radius);
        padding: .6rem .85rem;
        margin-bottom: .4rem;
        display: flex;
        align-items: center;
        gap: .75rem;
        cursor: grab;
        user-select: none;
        transition: opacity .15s, box-shadow .15s;
      }
      .fr-item:active { cursor: grabbing; }
      .fr-item.dragging { opacity: .35; box-shadow: none; }
      .fr-item.drag-target { box-shadow: 0 0 0 2px var(--accent); }
      .fr-item-num {
        flex-shrink: 0;
        width: 28px; height: 28px;
        background: var(--accent-light);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: bold; color: var(--accent-text);
      }
      .fr-item-num.off { background: var(--surface); color: var(--text3); border: 0.5px solid var(--border); }
      .fr-item-info { flex: 1; min-width: 0; }
      .fr-item-label { font-size: 13px; color: var(--text); font-weight: 500; }
      .fr-item-entity { font-size: 11px; color: var(--text3); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fr-item-handle { font-size: 16px; color: var(--text3); cursor: grab; }
      .fr-drop-placeholder {
        text-align: center; font-size: 12px; color: var(--text3);
        padding: 1rem; width: 100%;
      }
      .fr-empty-list {
        text-align: center; font-size: 12px; color: var(--text3); padding: 1.25rem .5rem;
      }
    </style>
  `;

  window._fr = { save: saveRoute, reload: () => { load().then(renderLists); } };
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function load() {
  try {
    const data = await get('/admin/fill-route/cubes');
    const all  = data.cubes || [];
    _onRoute   = all.filter(c => c.route_position !== null).sort((a, b) => a.route_position - b.route_position);
    _offRoute  = all.filter(c => c.route_position === null);
  } catch (e) {
    _toast('Failed to load cubes: ' + (e.message ?? 'unknown error'));
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderLists() {
  renderOnList();
  renderOffList();
  setDirty(false);
}

function renderOnList() {
  const list  = document.getElementById('fr-on-list');
  const count = document.getElementById('fr-on-count');
  if (!list) return;

  if (count) count.textContent = `(${_onRoute.length})`;

  if (_onRoute.length === 0) {
    list.innerHTML = '<div class="fr-empty-list">No cubes on route yet — drag from the right column</div>';
    attachZoneListeners(list, 'on');
    return;
  }

  list.innerHTML = _onRoute.map((c, i) => itemHtml(c, i + 1, 'on')).join('');
  attachZoneListeners(list, 'on');
  list.querySelectorAll('.fr-item').forEach(el => attachItemListeners(el));
}

function renderOffList() {
  const list = document.getElementById('fr-off-list');
  if (!list) return;

  const ph = list.querySelector('.fr-drop-placeholder');

  if (_offRoute.length === 0) {
    list.innerHTML = `
      <div class="fr-drop-placeholder" style="${_onRoute.length ? 'display:block' : 'display:none'}">
        Drop here to remove from route
      </div>
      ${_onRoute.length === 0 ? '<div class="fr-empty-list">All cubes are on the route</div>' : ''}
    `;
    attachZoneListeners(list, 'off');
    return;
  }

  list.innerHTML = `
    <div class="fr-drop-placeholder" style="display:none">Drop here to remove from route</div>
    ${_offRoute.map(c => itemHtml(c, null, 'off')).join('')}
  `;
  attachZoneListeners(list, 'off');
  list.querySelectorAll('.fr-item').forEach(el => attachItemListeners(el));
}

function itemHtml(cube, position, zone) {
  const numHtml = position !== null
    ? `<div class="fr-item-num">${position}</div>`
    : `<div class="fr-item-num off">–</div>`;
  const entity = cube.barrio_name ? escHtml(cube.barrio_name) : '<em>unassigned</em>';
  return `
    <div class="fr-item" draggable="true" data-id="${cube.id}" data-zone="${zone}">
      <span class="fr-item-handle">⠿</span>
      ${numHtml}
      <div class="fr-item-info">
        <div class="fr-item-label">${escHtml(cube.cube_label)}</div>
        <div class="fr-item-entity">${entity}</div>
      </div>
    </div>
  `;
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

let _dragId   = null;
let _dragZone = null;

function attachItemListeners(el) {
  el.addEventListener('dragstart', e => {
    _dragId   = +el.dataset.id;
    _dragZone = el.dataset.zone;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document.querySelectorAll('.fr-item.drag-target').forEach(t => t.classList.remove('drag-target'));
  });
  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.fr-item.drag-target').forEach(t => t.classList.remove('drag-target'));
    el.classList.add('drag-target');
  });
  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-target');
    if (_dragId === null || _dragId === +el.dataset.id) return;

    const targetId   = +el.dataset.id;
    const targetZone = el.dataset.zone;
    moveItem(_dragId, _dragZone, targetId, targetZone);
  });
}

function attachZoneListeners(zone, zoneName) {
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
    const ph = zone.querySelector('.fr-drop-placeholder');
    if (ph) ph.style.display = 'block';
  });
  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) {
      zone.classList.remove('drag-over');
      const ph = zone.querySelector('.fr-drop-placeholder');
      if (ph && zoneName === 'off') ph.style.display = _offRoute.length ? 'none' : 'block';
    }
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');

    if (_dragId === null) return;
    if (_dragZone === zoneName) return; // already in this zone — handled by item drop

    // Dropped on zone background (not on a specific item)
    if (zoneName === 'off') {
      moveToOff(_dragId);
    } else {
      moveToEnd(_dragId);
    }
  });
}

function moveItem(dragId, dragZone, targetId, targetZone) {
  // Remove from source list
  const srcList = dragZone === 'on' ? _onRoute : _offRoute;
  const idx     = srcList.findIndex(c => c.id === dragId);
  if (idx === -1) return;
  const [item]  = srcList.splice(idx, 1);

  // Insert into target list before/after the target
  const dstList  = targetZone === 'on' ? _onRoute : _offRoute;
  const targetIdx = dstList.findIndex(c => c.id === targetId);
  if (targetIdx === -1) {
    dstList.push(item);
  } else {
    dstList.splice(targetIdx, 0, item);
  }

  setDirty(true);
  renderLists();
}

function moveToOff(dragId) {
  const idx = _onRoute.findIndex(c => c.id === dragId);
  if (idx === -1) return;
  const [item] = _onRoute.splice(idx, 1);
  _offRoute.unshift(item);
  setDirty(true);
  renderLists();
}

function moveToEnd(dragId) {
  const idx = _offRoute.findIndex(c => c.id === dragId);
  if (idx === -1) return;
  const [item] = _offRoute.splice(idx, 1);
  _onRoute.push(item);
  setDirty(true);
  renderLists();
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveRoute() {
  const btn = document.getElementById('fr-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    await put('/admin/fill-route/order', {
      ordered_ids: _onRoute.map(c => c.id),
      unset_ids:   _offRoute.map(c => c.id),
    });
    _toast(`Route saved — ${_onRoute.length} stop${_onRoute.length !== 1 ? 's' : ''}`);
    setDirty(false);
    // Refresh to confirm saved positions
    await load();
    renderLists();
  } catch (e) {
    _toast('Failed to save: ' + (e.message ?? 'unknown error'));
    if (btn) { btn.disabled = false; btn.textContent = 'Save route'; }
  }
}

function setDirty(dirty) {
  _dirty = dirty;
  const btn = document.getElementById('fr-save-btn');
  if (btn) btn.style.display = dirty ? '' : 'none';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
