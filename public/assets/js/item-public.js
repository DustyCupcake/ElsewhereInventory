import { initLang, t, renderSwitcher, onLangChange } from './i18n.js?v=1.0.0';

// Contact email for found equipment — edit this string.
const SUPPORT_EMAIL = '[SUPPORT_EMAIL]';  // e.g. 'barrio-support@event.org'

const qr   = new URLSearchParams(window.location.search).get('qr') ?? '';
const wrap = document.getElementById('it-wrap');

initLang();
renderSwitcher(document.getElementById('lang-switcher'));
onLangChange(renderWithData);  // re-render text when language changes

let _data = null;

async function boot() {
  if (!qr) {
    _data = { found: false };
    renderWithData();
    return;
  }

  try {
    const res  = await fetch(`/api/item/info?qr=${encodeURIComponent(qr)}`);
    _data = await res.json();
  } catch {
    _data = { found: false };
  }
  renderWithData();
}

function renderWithData() {
  if (!_data) return; // still loading
  const i = (key) => t('item', key);

  document.title = `${i('pageTitle')} — Barrio Support`;

  if (!_data.found) {
    wrap.innerHTML = `
      <div class="it-not-found">
        <div class="it-not-found-icon">❓</div>
        <div class="it-not-found-title">${esc(i('notFound'))}</div>
        <p>${esc(i('notFoundNote'))}</p>
        <a href="mailto:${esc(resolvedEmail())}" class="it-email">${esc(resolvedEmail())}</a>
      </div>
    `;
    return;
  }

  // If this is a water voucher, show a redirect nudge.
  const voucherBlock = _data.is_voucher ? `
    <div class="it-voucher-note">
      <div class="it-section-title">💧 ${esc(i('voucherNote'))}</div>
      <a href="/voucher?qr=${encodeURIComponent(qr)}" class="btn primary" style="margin-top:.6rem">
        ${esc(i('checkVoucher'))}
      </a>
    </div>` : '';

  const statusKey   = { out: 'statusOut', available: 'statusIn', retired: 'statusRetired' }[_data.status] ?? 'statusIn';
  const statusLabel = i(statusKey);

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

    <div class="it-section">
      <div class="it-section-title">ℹ️</div>
      ${esc(i('systemNote'))}
    </div>

    <div class="it-section">
      <div class="it-section-title">${esc(i('foundTitle'))}</div>
      ${esc(i('foundNote'))}
      <a href="mailto:${esc(resolvedEmail())}" class="it-email">${esc(resolvedEmail())}</a>
    </div>

    <a href="/login" class="btn">${esc(i('loginBtn'))}</a>
  `;
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
