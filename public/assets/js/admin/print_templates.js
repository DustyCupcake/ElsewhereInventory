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
    _toggleGridFields,
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
        <th>Layout</th>
        <th>Item Filter</th>
        <th>Created</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${_templates.map(t => `
          <tr>
            <td><strong>${esc(t.name)}</strong></td>
            <td>${layoutBadge(t)}</td>
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
        <label>Layout</label>
        <select id="pt-new-mode" onchange="window._pt._toggleGridFields()">
          <option value="page">Full page — one item per page, zones are page-relative</option>
          <option value="grid">Label grid — multiple items per page, zones are tag-relative</option>
        </select>
      </div>

      <div id="pt-grid-fields" style="display:none">
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:.75rem 1rem;margin-bottom:.75rem;font-size:.82rem;color:var(--text2)">
          Zones are positioned relative to the top-left of each tag, in mm.
        </div>
        <div class="form-row">
          <label>Tag Width (mm)</label>
          <input type="number" id="pt-tag-w" step="0.1" min="1" placeholder="e.g. 90">
          <label>Tag Height (mm)</label>
          <input type="number" id="pt-tag-h" step="0.1" min="1" placeholder="e.g. 50">
        </div>
        <div class="form-row">
          <label>Columns</label>
          <input type="number" id="pt-cols" min="1" max="20" value="2">
          <label>Rows</label>
          <input type="number" id="pt-rows" min="1" max="20" value="5">
        </div>
        <div class="form-row">
          <label>Page margin (mm)</label>
          <input type="number" id="pt-margin" step="0.1" min="0" value="10">
          <label>Gap between tags (mm)</label>
          <input type="number" id="pt-gap" step="0.1" min="0" value="5">
        </div>
        <div class="form-row">
          <label>Page width (mm) <span style="color:var(--text3);font-size:.85em">blank = A4</span></label>
          <input type="number" id="pt-pg-w" step="0.1" min="1" placeholder="210">
          <label>Page height (mm) <span style="color:var(--text3);font-size:.85em">blank = A4</span></label>
          <input type="number" id="pt-pg-h" step="0.1" min="1" placeholder="297">
        </div>
      </div>

      <div class="form-row">
        <label id="pt-file-label">Template File <span style="color:var(--text3);font-size:.85em">(PDF, PNG or JPEG)</span></label>
        <input type="file" id="pt-new-file" accept=".pdf,.png,.jpg,.jpeg">
      </div>
      <div id="pt-file-hint" style="display:none;font-size:.8rem;color:var(--text2);margin-bottom:.5rem">
        Optional — used as the per-tag background image.
      </div>
      <div class="form-actions">
        <button class="btn primary" id="pt-save-btn" onclick="window._pt.saveNew()">Create</button>
        <button class="btn" onclick="window._pt.cancelNew()">Cancel</button>
      </div>
    </div>`;
}

function cancelNew() {
  const f = document.getElementById('pt-new-form');
  if (f) { f.style.display = 'none'; f.innerHTML = ''; }
}

function _toggleGridFields() {
  const mode      = document.getElementById('pt-new-mode')?.value;
  const gridFields = document.getElementById('pt-grid-fields');
  const fileHint  = document.getElementById('pt-file-hint');
  const fileLabel = document.getElementById('pt-file-label');
  const isGrid    = mode === 'grid';
  if (gridFields) gridFields.style.display = isGrid ? '' : 'none';
  if (fileHint)  fileHint.style.display  = isGrid ? '' : 'none';
  if (fileLabel) fileLabel.innerHTML = isGrid
    ? 'Tag Background <span style="color:var(--text3);font-size:.85em">(PDF, PNG or JPEG — optional)</span>'
    : 'Template File <span style="color:var(--text3);font-size:.85em">(PDF, PNG or JPEG)</span>';
}

async function saveNew() {
  const name   = document.getElementById('pt-new-name')?.value.trim();
  const filter = document.getElementById('pt-new-filter')?.value.trim();
  const mode   = document.getElementById('pt-new-mode')?.value ?? 'page';
  const file   = document.getElementById('pt-new-file')?.files?.[0];
  const btn    = document.getElementById('pt-save-btn');

  if (!name) { _toast('Enter a template name'); return; }
  if (mode === 'page' && !file) { _toast('Select a template file'); return; }
  if (mode === 'grid') {
    const tw = parseFloat(document.getElementById('pt-tag-w')?.value);
    const th = parseFloat(document.getElementById('pt-tag-h')?.value);
    if (!tw || !th) { _toast('Enter tag width and height'); return; }
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'; }

  try {
    const fd = new FormData();
    fd.append('name',        name);
    fd.append('item_filter', filter ?? '');
    fd.append('layout_mode', mode);
    if (file) fd.append('file', file);

    if (mode === 'grid') {
      fd.append('tag_width_mm',   document.getElementById('pt-tag-w')?.value ?? '');
      fd.append('tag_height_mm',  document.getElementById('pt-tag-h')?.value ?? '');
      fd.append('page_cols',      document.getElementById('pt-cols')?.value   ?? '2');
      fd.append('page_rows',      document.getElementById('pt-rows')?.value   ?? '5');
      fd.append('margin_mm',      document.getElementById('pt-margin')?.value ?? '10');
      fd.append('gap_mm',         document.getElementById('pt-gap')?.value    ?? '5');
      fd.append('page_width_mm',  document.getElementById('pt-pg-w')?.value   ?? '');
      fd.append('page_height_mm', document.getElementById('pt-pg-h')?.value   ?? '');
    }

    const res = await fetch('/api/admin/qr-templates', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'X-CSRF-Token': getCsrf() },
      body:        fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Creation failed');

    _toast('Template created');
    cancelNew();
    await loadList();
  } catch (e) {
    _toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Create'; }
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
  // eslint-disable-next-line eqeqeq — PDO may return id as string or number
  const tmpl = _templates.find(t => t.id == id);
  if (!tmpl) { _toast('Template not found'); return; }

  document.getElementById('pt-list-area').style.display   = 'none';
  document.getElementById('pt-new-form').style.display    = 'none';
  const editorArea = document.getElementById('pt-editor-area');
  editorArea.style.display = '';

  const isGrid   = tmpl.layout_mode === 'grid';
  const subtitle = isGrid
    ? `Label grid — ${tmpl.page_cols}×${tmpl.page_rows} per page, tag ${tmpl.tag_width_mm}×${tmpl.tag_height_mm} mm. Zone positions are relative to the top-left of each tag.`
    : 'Full page — one item per page. Positions are in millimetres from the top-left corner of the page.';

  const previewHtml = tmpl.pdf_filename
    ? `<iframe src="/api/admin/qr-templates/${id}/preview" class="pt-preview-frame" title="Template preview"></iframe>`
    : `<div class="empty" style="height:200px;display:flex;align-items:center;justify-content:center;color:var(--text3)">No background file — plain white tag</div>`;

  editorArea.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div>
        <div class="page-title">${esc(tmpl.name)}</div>
        <div class="page-subtitle">${subtitle}</div>
      </div>
      <div class="btn-group">
        <button class="btn" onclick="window._pt.backToList()">← Back</button>
        <button class="btn primary" onclick="window._pt.saveZones()">Save Zones</button>
      </div>
    </div>
    <div class="pt-editor-layout">
      <div class="pt-preview-panel">
        <div class="pt-preview-label">${isGrid ? 'Tag Background Preview' : 'Template Preview'}</div>
        ${previewHtml}
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
  // eslint-disable-next-line eqeqeq — PDO may return id as string or number
  const tmpl = _templates.find(t => t.id == id);
  if (!tmpl) { _toast('Template not found'); return; }

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

function layoutBadge(t) {
  if (t.layout_mode === 'grid') {
    return `<span class="badge available">${t.page_cols}×${t.page_rows} grid</span>
            <span style="color:var(--text3);font-size:.8em;margin-left:.3rem">${t.tag_width_mm}×${t.tag_height_mm} mm</span>`;
  }
  return '<span class="badge">Full page</span>';
}

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
