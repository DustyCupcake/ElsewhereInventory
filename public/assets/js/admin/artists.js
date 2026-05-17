/**
 * Admin artists section — list, create, edit, delete, CSV import.
 * Dept admins see only their own department's artists (server-filtered).
 * Production admins see all; CSV import shows a dept selector for them.
 */

import { get, post, put, del, getCsrf } from '../api.js?v=1.0.1';

let _toast;
let _artists  = [];
let _depts    = [];      // populated for manage_departments users only
let _myDeptId = null;    // dept admin's single artist-dept id
let _isFullAdmin = false;

export async function initArtists(container, toast, user = null) {
  _toast       = toast;
  const perms  = user?.permissions ?? [];
  _isFullAdmin = perms.includes('manage_departments');

  // For dept admins, use the first dept_id from their session
  if (!_isFullAdmin && user?.dept_ids?.length) {
    _myDeptId = user.dept_ids[0];
  }

  render(container);

  const loads = [load(container)];
  if (_isFullAdmin) loads.push(loadDepts());
  await Promise.all(loads);
}

async function loadDepts() {
  try {
    const data = await get('/admin/departments');
    _depts = (data.departments || []).filter(d => d.sub_entity === 'artist');
  } catch { /* non-fatal */ }
}

function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Artists</div>
        <div class="page-subtitle">Manage artist groups that can hold equipment</div>
      </div>
      <div class="btn-group">
        <button class="btn primary sm" onclick="window._artists.openAdd()">+ Add artist</button>
        <button class="btn sm" onclick="window._artists.openImport()">Import CSV</button>
      </div>
    </div>

    <div class="form-card" id="import-form" style="display:none">
      <h2>Import artists via CSV</h2>
      <p style="margin:0 0 8px;color:var(--text2);font-size:14px">
        Required column: <code>name</code>. Optional: <code>sort_order</code>, <code>assigned_staff</code> (username).
      </p>
      <div id="import-dept-field"></div>
      <div class="field">
        <input type="file" id="import-file" accept=".csv">
      </div>
      <div class="form-actions">
        <button class="btn primary sm" onclick="window._artists.runImport()">Import</button>
        <button class="btn sm" onclick="window._artists.closeImport()">Cancel</button>
      </div>
    </div>

    <div class="form-card" id="artist-form" style="display:none">
      <h2 id="artist-form-title">Add artist</h2>
      <input type="hidden" id="artist-id">
      <div id="artist-dept-field"></div>
      <div class="field">
        <label for="artist-name">Name</label>
        <input type="text" id="artist-name" placeholder="e.g. Soundscape Collective" maxlength="128">
      </div>
      <div class="field">
        <label for="artist-sort">Sort order</label>
        <input type="text" id="artist-sort" placeholder="0" style="max-width:80px">
      </div>
      <div class="field">
        <label for="artist-staff">Assigned staff username <span style="color:var(--text3)">(optional)</span></label>
        <input type="text" id="artist-staff" placeholder="username">
      </div>
      <div class="form-actions">
        <button class="btn primary sm" onclick="window._artists.save()">Save</button>
        <button class="btn sm" onclick="window._artists.closeForm()">Cancel</button>
      </div>
    </div>

    <div id="artist-table-wrap">
      <div class="empty"><span class="spinner"></span> Loading…</div>
    </div>
  `;

  window._artists = {
    openAdd, openEdit, save, closeForm,
    remove: removeArtist,
    openImport, closeImport, runImport,
  };
}

async function load(container) {
  const wrap = container?.querySelector('#artist-table-wrap') ?? document.getElementById('artist-table-wrap');
  try {
    const data = await get('/admin/artists');
    _artists   = data.artists || [];
    renderTable(wrap);
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty">Failed to load: ${e.message}</div>`;
    _toast('Error: ' + e.message);
  }
}

function renderTable(wrap) {
  if (!wrap) return;
  if (!_artists.length) {
    wrap.innerHTML = '<div class="empty">No artists yet — add one above</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          ${_isFullAdmin ? '<th>Team</th>' : ''}
          <th>Assigned staff</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${_artists.map(a => `
          <tr>
            <td>${esc(a.name)}</td>
            ${_isFullAdmin ? `<td style="color:var(--text2);font-size:13px">${esc(a.dept_name)}</td>` : ''}
            <td style="color:var(--text2);font-size:13px">${a.assigned_staff_name ? esc(a.assigned_staff_name) : '—'}</td>
            <td>
              <div class="table-actions">
                <button class="action-btn" onclick="window._artists.openEdit(${a.id})">Edit</button>
                <button class="action-btn danger" onclick="window._artists.remove(${a.id})">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── Add / edit form ──────────────────────────────────────────────────────────

function deptSelectHtml(selectedId = null) {
  if (!_isFullAdmin) return '';
  const options = _depts.map(d =>
    `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${esc(d.name)}</option>`
  ).join('');
  return `
    <div class="field">
      <label for="artist-dept">Team</label>
      <select id="artist-dept">${options}</select>
    </div>`;
}

function openAdd() {
  closeImport();
  document.getElementById('artist-form-title').textContent = 'Add artist';
  document.getElementById('artist-id').value    = '';
  document.getElementById('artist-name').value  = '';
  document.getElementById('artist-sort').value  = '0';
  document.getElementById('artist-staff').value = '';
  document.getElementById('artist-dept-field').innerHTML = deptSelectHtml();
  document.getElementById('artist-form').style.display = '';
  document.getElementById('artist-name').focus();
}

function openEdit(id) {
  closeImport();
  const a = _artists.find(x => x.id === id);
  if (!a) return;
  document.getElementById('artist-form-title').textContent = 'Edit artist';
  document.getElementById('artist-id').value    = id;
  document.getElementById('artist-name').value  = a.name;
  document.getElementById('artist-sort').value  = a.sort_order ?? 0;
  document.getElementById('artist-staff').value = a.assigned_staff_name ?? '';
  document.getElementById('artist-dept-field').innerHTML = deptSelectHtml(a.dept_id);
  document.getElementById('artist-form').style.display = '';
  document.getElementById('artist-name').focus();
}

function closeForm() {
  document.getElementById('artist-form').style.display = 'none';
}

async function save() {
  const id        = document.getElementById('artist-id').value;
  const name      = document.getElementById('artist-name').value.trim();
  const sort      = parseInt(document.getElementById('artist-sort').value || '0');
  const staffName = document.getElementById('artist-staff').value.trim();
  const dept_id   = _isFullAdmin
    ? +(document.getElementById('artist-dept')?.value ?? 0)
    : _myDeptId;

  if (!name) { _toast('Name required'); return; }
  if (!dept_id) { _toast('Team required'); return; }

  const body = { name, sort_order: sort, dept_id };
  if (staffName) body.assigned_staff_username = staffName;
  if (id) body.id = +id;

  try {
    if (id) {
      await put('/admin/artists', body);
      _toast('Artist updated');
    } else {
      await post('/admin/artists', body);
      _toast('Artist created');
    }
    closeForm();
    await load();
  } catch (e) {
    _toast('Error: ' + e.message);
  }
}

async function removeArtist(id) {
  const a = _artists.find(x => x.id === id);
  if (!confirm(`Delete "${a?.name}"?`)) return;
  try {
    await del('/admin/artists', { id });
    _toast('Artist deleted');
    await load();
  } catch (e) {
    _toast('Error: ' + e.message);
  }
}

// ─── CSV import ───────────────────────────────────────────────────────────────

function openImport() {
  closeForm();
  document.getElementById('import-file').value = '';

  const deptField = document.getElementById('import-dept-field');
  if (_isFullAdmin) {
    const options = _depts.map(d =>
      `<option value="${d.id}">${esc(d.name)}</option>`
    ).join('');
    deptField.innerHTML = `
      <div class="field">
        <label for="import-dept">Team</label>
        <select id="import-dept">${options}</select>
      </div>`;
  } else {
    deptField.innerHTML = '';
  }

  document.getElementById('import-form').style.display = '';
}

function closeImport() {
  document.getElementById('import-form').style.display = 'none';
}

async function runImport() {
  const fileInput = document.getElementById('import-file');
  const file = fileInput?.files?.[0];
  if (!file) { _toast('Select a CSV file first'); return; }

  const deptId = _isFullAdmin
    ? +(document.getElementById('import-dept')?.value ?? 0)
    : _myDeptId;

  if (!deptId) { _toast('Team required'); return; }

  const btn = document.querySelector('#import-form .btn.primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…'; }

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`/api/admin/artists/import-csv?dept_id=${deptId}`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'X-CSRF-Token': getCsrf() },
      body:        formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');

    const { created = 0, updated = 0, skipped = 0 } = data;
    _toast(`Imported: ${created} created, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`);
    closeImport();
    await load();
  } catch (e) {
    _toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
  }
}

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
