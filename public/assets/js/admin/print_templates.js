/**
 * Admin — Print Templates section.
 * Upload PDF/image templates, define QR zone placement, generate label PDFs.
 */

import { get, post, put, del, getCsrf } from '../api.js?v=1.0.1';

let _toast;
let _templates = [];
let _editId    = null; // template currently being edited
let _zones     = [];

export async function initPrintTemplates(container, toast) {
  _toast = toast;
  renderShell(container);
  await loadList();

  window._pt = {
    openNew, saveNew, cancelNew,
    editZones, backToList,
    addZone, removeZone, saveZones,
    generate, del: deleteTemplate,
    _zoneChange(idx, field, value) {
      if (_zones[idx]) {
        _zones[idx][field] = value;
        if (field === 'zone_type') renderZones();
      }
    },
  };
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function renderShell(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Print Templates</div>
        <div class="page-subtitle">Upload a PDF or image template, define QR code placement, generate label PDFs.</div>
      </div>
      <div class="btn-group">
        <button class="btn primary" onclick="window._pt.openNew()">+ New Template</button>
      </div>
    </div>
    <div id="pt-new-form" style="display:none"></div>
    <div id="pt-list-area"><div class="empty"><span class="spinner"></span></div></div>
    <div id="pt-editor-area" style="display:none"></div>
  `;
}

// ─── List view ────────────────────────────────────────────────────────────────

async function loadList() {
  const wrap = document.getElementById('pt-list-area');
  try {
    const data = await get('/admin/qr-templates');
    _templates = data.templates || [];
    renderList(wrap);
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty">Failed to load: ${esc(e.message)}</div>`;
    _toast('Error: ' + e.message);
  }
}

function renderList(wrap) {
  if (!wrap) return;
  if (!_templates.length) {
    wrap.innerHTML = '<div class="empty">No templates yet — upload one to get started.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Name</th>
        <th>Item Filter</th>
        <th>Created</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${_templates.map(t => `
          <tr>
            <td><strong>${esc(t.name)}</strong></td>
            <td>${t.item_filter ? `<span class="badge active">${esc(t.item_filter)}</span>` : '<span style="color:var(--text3)">All items</span>'}</td>
            <td style="color:var(--text2);font-size:.85em">${fmtDate(t.created_at)}</td>
            <td class="table-actions">
              <button class="btn sm" onclick="window._pt.editZones(${t.id})">Edit Zones</button>
              <button class="btn sm primary" onclick="window._pt.generate(${t.id})">Generate PDF</button>
              <button class="btn sm danger" onclick="window._pt.del(${t.id}, '${esc(t.name).replace(/'/g, "\\'")}')">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// ─── New template form ────────────────────────────────────────────────────────

function openNew() {
  const formArea = document.getElementById('pt-new-form');
  if (!formArea) return;
  formArea.style.display = '';
  formArea.innerHTML = `
    <div class="form-card" style="margin-bottom:1.5rem">
      <h2>New Template</h2>
      <div class="form-row">
        <label>Name</label>
        <input type="text" id="pt-new-name" placeholder="e.g. Water Cube Label" autocomplete="off">
      </div>
      <div class="form-row">
        <label>Item Filter <span style="color:var(--text3);font-size:.85em">(optional — category slug)</span></label>
        <input type="text" id="pt-new-filter" placeholder="e.g. water_cube — leave blank for all items" autocomplete="off">
      </div>
      <div class="form-row">
        <label>Template File <span style="color:var(--text3);font-size:.85em">(PDF, PNG or JPEG)</span></label>
        <input type="file" id="pt-new-file" accept=".pdf,.png,.jpg,.jpeg">
      </div>
      <div class="form-actions">
        <button class="btn primary" id="pt-save-btn" onclick="window._pt.saveNew()">Upload</button>
        <button class="btn" onclick="window._pt.cancelNew()">Cancel</button>
      </div>
    </div>`;
}

function cancelNew() {
  const f = document.getElementById('pt-new-form');
  if (f) { f.style.display = 'none'; f.innerHTML = ''; }
}

async function saveNew() {
  const name   = document.getElementById('pt-new-name')?.value.trim();
  const filter = document.getElementById('pt-new-filter')?.value.trim();
  const file   = document.getElementById('pt-new-file')?.files?.[0];
  const btn    = document.getElementById('pt-save-btn');

  if (!name)  { _toast('Enter a template name'); return; }
  if (!file)  { _toast('Select a file to upload'); return; }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Uploading…'; }

  try {
    const fd = new FormData();
    fd.append('name',        name);
    fd.append('item_filter', filter);
    fd.append('file',        file);

    const res = await fetch('/api/admin/qr-templates', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'X-CSRF-Token': getCsrf() },
      body:        fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    _toast('Template created');
    cancelNew();
    await loadList();
  } catch (e) {
    _toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteTemplate(id, name) {
  if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
  try {
    await del(`/admin/qr-templates/${id}`);
    _toast('Template deleted');
    await loadList();
  } catch (e) {
    _toast('Error: ' + e.message);
  }
}

// ─── Zone editor ─────────────────────────────────────────────────────────────

async function editZones(id) {
  _editId = id;
  const tmpl = _templates.find(t => t.id === id);
  if (!tmpl) return;

  document.getElementById('pt-list-area').style.display   = 'none';
  document.getElementById('pt-new-form').style.display    = 'none';
  const editorArea = document.getElementById('pt-editor-area');
  editorArea.style.display = '';

  editorArea.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div>
        <div class="page-title">${esc(tmpl.name)}</div>
        <div class="page-subtitle">Define where QR codes and labels appear on the template. Positions are in millimetres from the top-left corner.</div>
      </div>
      <div class="btn-group">
        <button class="btn" onclick="window._pt.backToList()">← Back</button>
        <button class="btn primary" onclick="window._pt.saveZones()">Save Zones</button>
      </div>
    </div>
    <div class="pt-editor-layout">
      <div class="pt-preview-panel">
        <div class="pt-preview-label">Template Preview</div>
        <iframe src="/api/admin/qr-templates/${id}/preview"
                class="pt-preview-frame"
                title="Template preview"></iframe>
      </div>
      <div class="pt-zones-panel">
        <div class="pt-zones-header">
          <strong>Zones</strong>
          <button class="btn sm primary" onclick="window._pt.addZone()">+ Add Zone</button>
        </div>
        <div id="pt-zones-list"><div class="empty"><span class="spinner"></span></div></div>
      </div>
    </div>`;

  try {
    const data = await get(`/admin/qr-templates/${id}/zones`);
    _zones = data.zones || [];
    renderZones();
  } catch (e) {
    _toast('Error loading zones: ' + e.message);
    _zones = [];
    renderZones();
  }
}

function backToList() {
  _editId = null;
  _zones  = [];
  document.getElementById('pt-editor-area').style.display  = 'none';
  document.getElementById('pt-list-area').style.display    = '';
}

function renderZones() {
  const wrap = document.getElementById('pt-zones-list');
  if (!wrap) return;

  if (!_zones.length) {
    wrap.innerHTML = '<div class="empty" style="padding:1rem">No zones yet — add one above.</div>';
    return;
  }

  wrap.innerHTML = _zones.map((z, i) => `
    <div class="pt-zone-row" data-idx="${i}">
      <div class="pt-zone-row-header">
        <span class="badge ${zoneBadgeClass(z.zone_type)}">${zoneLabel(z.zone_type)}</span>
        <button class="btn sm danger" onclick="window._pt.removeZone(${i})">Remove</button>
      </div>
      <div class="pt-zone-fields">
        <label>Type</label>
        <select onchange="window._pt._zoneChange(${i}, 'zone_type', this.value)">
          ${['qr_code','item_number','item_name','custom_text'].map(t =>
            `<option value="${t}" ${z.zone_type === t ? 'selected' : ''}>${zoneLabel(t)}</option>`
          ).join('')}
        </select>
        <label>X (mm)</label>
        <input type="number" step="0.1" value="${z.x_mm}" onchange="window._pt._zoneChange(${i}, 'x_mm', +this.value)">
        <label>Y (mm)</label>
        <input type="number" step="0.1" value="${z.y_mm}" onchange="window._pt._zoneChange(${i}, 'y_mm', +this.value)">
        <label>${z.zone_type === 'qr_code' ? 'Size (mm)' : 'Width (mm)'}</label>
        <input type="number" step="0.1" min="1" value="${z.size_mm}" onchange="window._pt._zoneChange(${i}, 'size_mm', +this.value)">
        ${z.zone_type !== 'qr_code' ? `
          <label>Font Size (pt)</label>
          <input type="number" step="1" min="6" max="72" value="${z.font_size}" onchange="window._pt._zoneChange(${i}, 'font_size', +this.value)">
        ` : ''}
        ${z.zone_type === 'custom_text' ? `
          <label>Text</label>
          <input type="text" value="${esc(z.custom_value || '')}" onchange="window._pt._zoneChange(${i}, 'custom_value', this.value)">
        ` : ''}
      </div>
    </div>
  `).join('');
}

function addZone() {
  _zones.push({ zone_type: 'qr_code', page: 1, x_mm: 10, y_mm: 10, size_mm: 40, custom_value: '', font_size: 12 });
  renderZones();
}

function removeZone(idx) {
  _zones.splice(idx, 1);
  renderZones();
}

async function saveZones() {
  try {
    await put(`/admin/qr-templates/${_editId}/zones`, { zones: _zones });
    _toast('Zones saved');
  } catch (e) {
    _toast('Error: ' + e.message);
  }
}

// ─── Generate ─────────────────────────────────────────────────────────────────

async function generate(id) {
  const tmpl = _templates.find(t => t.id === id);
  if (!tmpl) return;

  try {
    const res = await fetch(`/api/admin/qr-templates/${id}/generate`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'X-CSRF-Token': getCsrf(), 'Content-Type': 'application/json' },
      body:        JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Generation failed' }));
      throw new Error(err.error || 'Generation failed');
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = tmpl.name.replace(/[^a-z0-9_-]/gi, '_') + '_labels.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _toast('PDF downloaded');
  } catch (e) {
    _toast('Error: ' + e.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function zoneLabel(type) {
  return { qr_code: 'QR Code', item_number: 'Item Number', item_name: 'Item Name', custom_text: 'Custom Text' }[type] ?? type;
}

function zoneBadgeClass(type) {
  return { qr_code: 'active', item_number: '', item_name: '', custom_text: 'inactive' }[type] ?? '';
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString();
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
