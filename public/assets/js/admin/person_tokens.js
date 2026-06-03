/**
 * Admin Person Badges section.
 * Generate pre-printed QR badge pool, view claim status, unclaim/reassign.
 */

import { get, post, del } from '../api.js?v=1.0.1';

let _toast   = null;
let _tokens  = [];

export async function initPersonTokens(container, toast) {
  _toast = toast;
  renderShell(container);
  await load();
}

async function load() {
  try {
    const data = await get('/admin/person-tokens');
    _tokens = data.tokens || [];
    renderTable();
  } catch (e) {
    _toast('Failed to load badges: ' + e.message);
  }
}

function renderShell(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Person Badges</div>
        <div class="page-subtitle">Pre-generated QR codes — one per attendee. No account needed.</div>
      </div>
      <div style="display:flex;gap:.5rem">
        <button class="btn sm" id="pt-print-btn">🖨 Print QR sheet</button>
        <button class="btn primary sm" id="pt-generate-btn">+ Generate badges</button>
      </div>
    </div>

    <!-- Generate form -->
    <div id="pt-generate-form" class="form-card" style="display:none;margin-bottom:1rem">
      <div class="form-card-title">Generate new badges</div>
      <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="margin-bottom:0">
          <label>Count</label>
          <input type="number" id="pt-gen-count" value="10" min="1" max="500" style="width:80px">
        </div>
        <div class="field" style="margin-bottom:0;flex:1;min-width:140px">
          <label>Label prefix <span style="color:var(--text3);font-weight:400">(optional)</span></label>
          <input type="text" id="pt-gen-prefix" placeholder="e.g. Badge" style="width:100%">
        </div>
        <button class="btn primary" id="pt-gen-submit">Generate</button>
        <button class="btn" id="pt-gen-cancel">Cancel</button>
      </div>
      <div id="pt-gen-msg" style="font-size:13px;margin-top:.5rem;display:none"></div>
    </div>

    <!-- Table -->
    <div id="pt-table-wrap"></div>`;

  document.getElementById('pt-print-btn')?.addEventListener('click', () => {
    window.open('/api/admin/person-tokens/qr-sheet', '_blank');
  });

  document.getElementById('pt-generate-btn')?.addEventListener('click', () => {
    document.getElementById('pt-generate-form').style.display = '';
    document.getElementById('pt-generate-btn').style.display = 'none';
    document.getElementById('pt-gen-count')?.focus();
  });

  document.getElementById('pt-gen-cancel')?.addEventListener('click', () => {
    document.getElementById('pt-generate-form').style.display = 'none';
    document.getElementById('pt-generate-btn').style.display = '';
  });

  document.getElementById('pt-gen-submit')?.addEventListener('click', generate);
}

function renderTable() {
  const wrap = document.getElementById('pt-table-wrap');
  if (!wrap) return;

  if (_tokens.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No badges yet — generate some above.</div>`;
    return;
  }

  const claimed   = _tokens.filter(t => t.claimed_at).length;
  const unclaimed = _tokens.length - claimed;

  wrap.innerHTML = `
    <div style="font-size:13px;color:var(--text3);margin-bottom:.75rem">
      ${_tokens.length} total · ${claimed} claimed · ${unclaimed} unclaimed
    </div>
    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Status</th>
            <th>Person</th>
            <th>Claimed</th>
            <th>Items out</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${_tokens.map(t => `
            <tr data-id="${t.id}">
              <td style="font-family:monospace;font-size:13px">${esc(t.label || '—')}</td>
              <td>${t.claimed_at
                ? '<span class="badge claimed">Claimed</span>'
                : '<span class="badge unclaimed">Unclaimed</span>'}</td>
              <td>${t.display_name ? esc(t.display_name) : '<span style="color:var(--text3)">—</span>'}</td>
              <td style="font-size:13px;color:var(--text2)">${t.claimed_at ? fmtDate(t.claimed_at) : '—'}</td>
              <td style="text-align:center">${t.active_item_count > 0
                ? `<strong style="color:var(--warn)">${t.active_item_count}</strong>`
                : '<span style="color:var(--text3)">0</span>'}</td>
              <td>
                ${t.claimed_at ? `
                  <button class="btn sm pt-unclaim-btn"
                    data-id="${t.id}" data-name="${esc(t.display_name || t.label || 'this badge')}"
                    data-items="${t.active_item_count}"
                    ${t.active_item_count > 0 ? 'disabled title="Return items first"' : ''}>
                    Unclaim
                  </button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  wrap.querySelectorAll('.pt-unclaim-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id    = +btn.dataset.id;
      const name  = btn.dataset.name;
      const items = +btn.dataset.items;
      if (items > 0) { _toast('Return all items before unclaiming'); return; }
      if (!confirm(`Unclaim badge for ${name}? The badge can be reused; the person's borrowing history is preserved.`)) return;
      doUnclaim(id, btn);
    });
  });
}

async function generate() {
  const count  = parseInt(document.getElementById('pt-gen-count')?.value, 10) || 0;
  const prefix = document.getElementById('pt-gen-prefix')?.value.trim();
  const msg    = document.getElementById('pt-gen-msg');
  const btn    = document.getElementById('pt-gen-submit');

  if (count < 1 || count > 500) {
    if (msg) { msg.textContent = 'Count must be between 1 and 500.'; msg.style.display = ''; msg.style.color = 'var(--danger)'; }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Generating…';
  if (msg) msg.style.display = 'none';

  try {
    const data = await post('/admin/person-tokens', { count, label_prefix: prefix || null });
    if (msg) {
      msg.textContent = `Generated ${data.generated || count} badge${(data.generated || count) !== 1 ? 's' : ''}.`;
      msg.style.color = 'var(--accent)';
      msg.style.display = '';
    }
    await load();
  } catch (e) {
    if (msg) { msg.textContent = 'Error: ' + e.message; msg.style.color = 'var(--danger)'; msg.style.display = ''; }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

async function doUnclaim(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Unclaiming…'; }
  try {
    await del(`/admin/person-tokens/${id}`);
    _toast('Badge unclaimed');
    await load();
  } catch (e) {
    _toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Unclaim'; }
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
