/**
 * Account panel — personal QR, borrowed items, password change, scan settings.
 */

import { get, post } from './api.js?v=1.0.1';
import { toast } from './app.js?v=1.0.1';

const SETTINGS_KEY = 'scan_settings';

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch { return {}; }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export function init(user) {
  const btn   = document.getElementById('header-user-btn');
  const modal = document.getElementById('account-modal');
  if (!btn || !modal) return;

  btn.textContent = user.display_name;

  btn.addEventListener('click', () => openPanel(user));

  document.getElementById('account-modal-close')?.addEventListener('click', closePanel);
  modal.addEventListener('click', e => { if (e.target === modal) closePanel(); });
}

function openPanel(user) {
  const modal = document.getElementById('account-modal');
  if (!modal) return;

  document.getElementById('account-modal-name').textContent = user.display_name;
  modal.style.display = '';

  // Reset QR cache each open so theme changes are picked up
  const qrWrap = document.getElementById('account-qr-wrap');
  if (qrWrap) delete qrWrap.dataset.loaded;
  loadQr();
  loadItems();
  renderScanSettings();
  wirePasswordForm();
}

// Read a CSS variable value from the root, strip '#', return as a 6-char hex string.
function cssHex(varName) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName).trim().replace('#', '');
  // Handle shorthand (#abc → aabbcc)
  if (raw.length === 3) return raw.split('').map(c => c + c).join('');
  return raw.slice(0, 6) || null;
}

async function loadQr() {
  const wrap = document.getElementById('account-qr-wrap');
  if (!wrap) return;
  if (wrap.dataset.loaded) return;
  wrap.dataset.loaded = '1';

  wrap.innerHTML = '<div style="text-align:center;color:var(--text3);font-size:13px;padding:.5rem 0">Loading…</div>';
  try {
    // Pass the page's actual computed text + surface colors so the QR matches the theme.
    const fg = cssHex('--text')    || '1a1a18';
    const bg = cssHex('--surface') || 'ffffff';
    const data = await get(`/my-qr-img?fg=${encodeURIComponent(fg)}&bg=${encodeURIComponent(bg)}`);

    if (data.svg) {
      // Inline SVG — scales perfectly, no pixelation, fully themed
      wrap.innerHTML = `
        <div style="text-align:center">
          <div style="width:min(220px,80vw);height:auto;margin:0 auto .5rem;
            border-radius:var(--radius);border:0.5px solid var(--border-med);
            overflow:hidden;line-height:0">
            ${data.svg}
          </div>
          <a href="/api/my-qr" target="_blank"
            style="font-size:12px;color:var(--text3);text-decoration:underline">
            Open full-screen →
          </a>
        </div>`;
    } else {
      // Fallback for when phpqrcode isn't available (external PNG)
      wrap.innerHTML = `
        <div style="text-align:center">
          <img src="${data.src}" alt="My QR code"
            style="width:min(220px,80vw);height:auto;border-radius:var(--radius);
            border:0.5px solid var(--border-med);display:block;margin:0 auto .5rem">
          <a href="/api/my-qr" target="_blank"
            style="font-size:12px;color:var(--text3);text-decoration:underline">
            Open full-screen →
          </a>
        </div>`;
    }
  } catch {
    wrap.innerHTML = '<a href="/api/my-qr" target="_blank" class="account-qr-link"><span class="account-qr-hint">Open full QR →</span></a>';
  }
}

function closePanel() {
  const modal = document.getElementById('account-modal');
  if (modal) modal.style.display = 'none';
}

async function loadItems() {
  const list = document.getElementById('account-items-list');
  if (!list) return;
  list.innerHTML = '<div class="account-items-empty">Loading…</div>';

  try {
    const data  = await get('/persons/my-items');
    const items = data.items || [];

    if (!items.length) {
      list.innerHTML = '<div class="account-items-empty">Nothing checked out to you</div>';
      return;
    }

    list.innerHTML = items.map(it => `
      <div class="account-item-row">
        <div class="account-item-name">${esc(it.name)}</div>
        ${it.location_name ? `<div class="account-item-sub">At: ${esc(it.location_name)}</div>` : ''}
        ${it.dept_label    ? `<div class="account-item-sub">${esc(it.dept_label)}</div>` : ''}
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="account-items-empty">Could not load items</div>';
  }
}

function wirePasswordForm() {
  const btn = document.getElementById('acc-pw-save');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', changePassword);
}

async function changePassword() {
  const current = document.getElementById('acc-pw-current')?.value ?? '';
  const newPass = document.getElementById('acc-pw-new')?.value ?? '';
  const confirm = document.getElementById('acc-pw-confirm')?.value ?? '';
  const msg     = document.getElementById('acc-pw-msg');

  const showMsg = (text, ok) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className   = 'acc-pw-msg ' + (ok ? 'acc-pw-ok' : 'acc-pw-err');
    msg.style.display = '';
  };

  if (!current || !newPass || !confirm) { showMsg('All fields are required'); return; }
  if (newPass.length < 8)              { showMsg('New password must be at least 8 characters'); return; }
  if (newPass !== confirm)             { showMsg('Passwords do not match'); return; }

  try {
    await post('/auth/change-password', {
      current_password:  current,
      new_password:      newPass,
      confirm_password:  confirm,
    });
    showMsg('Password changed successfully', true);
    document.getElementById('acc-pw-current').value = '';
    document.getElementById('acc-pw-new').value = '';
    document.getElementById('acc-pw-confirm').value = '';
  } catch (e) {
    showMsg(e.message || 'Error changing password');
  }
}

function renderScanSettings() {
  const container = document.getElementById('account-scan-settings');
  if (!container) return;

  const s = getSettings();
  const haptic      = s.haptic      !== false;
  const sound       = s.sound       !== false;
  const triggerMode = s.triggerMode ?? 'auto';

  container.innerHTML = `
    <label class="setting-toggle-row">
      <span class="setting-toggle-label">Haptic feedback</span>
      <input type="checkbox" id="ss-haptic" ${haptic ? 'checked' : ''}>
      <span class="setting-toggle-track"></span>
    </label>
    <label class="setting-toggle-row">
      <span class="setting-toggle-label">Sound feedback</span>
      <input type="checkbox" id="ss-sound" ${sound ? 'checked' : ''}>
      <span class="setting-toggle-track"></span>
    </label>
    <div class="setting-row">
      <div class="setting-row-label">Scan trigger</div>
      <div class="seg-ctrl">
        <button class="seg-btn ${triggerMode === 'auto' ? 'active' : ''}" data-val="auto">Auto</button>
        <button class="seg-btn ${triggerMode === 'trigger' ? 'active' : ''}" data-val="trigger">Manual trigger</button>
      </div>
      <div class="setting-row-hint">
        Manual trigger: camera stays open but only captures when you press a volume button or tap the screen (outside controls).
      </div>
    </div>
  `;

  container.querySelector('#ss-haptic')?.addEventListener('change', e => {
    saveSettings({ ...getSettings(), haptic: e.target.checked });
  });
  container.querySelector('#ss-sound')?.addEventListener('change', e => {
    saveSettings({ ...getSettings(), sound: e.target.checked });
  });
  container.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveSettings({ ...getSettings(), triggerMode: btn.dataset.val });
    });
  });
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
