/**
 * Public voucher status page — no authentication required.
 * Uses plain fetch (not api.js) to avoid auth wrappers.
 */

import { Scanner } from './scanner.js?v=1.0.0';

const wrap = document.getElementById('vc-wrap');
let scanner = null;

const STATUS_CONFIG = {
  confirmed: {
    icon:  '✓',
    title: 'Fill confirmed',
    body:  (data) => `Water filled and disinfected on ${formatDate(data.confirmed_at)}`,
  },
  validated: {
    icon:  '⏳',
    title: 'Voucher validated',
    body:  () => 'The validator has scanned this voucher — fill confirmation pending.',
  },
  activated: {
    icon:  '💧',
    title: 'Voucher is active',
    body:  () => 'This voucher is active and waiting to be filled at the next water run.',
  },
  pending: {
    icon:  '📋',
    title: 'Voucher registered',
    body:  () => 'Voucher registered but not yet activated for a water run. Speak to barrio support if you expected to receive water.',
  },
  unknown: {
    icon:  '⚠',
    title: 'Status unknown',
    body:  () => 'This voucher\'s status couldn\'t be determined — please speak to barrio support.',
  },
  not_found: {
    icon:  '⚠',
    title: 'QR not recognised',
    body:  () => 'This QR code wasn\'t found — please check the voucher or speak to barrio support.',
  },
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function renderScanner() {
  if (scanner) { scanner.stop(); scanner = null; }

  wrap.innerHTML = `
    <div class="vc-card">
      <div class="vc-card-label">Scan voucher QR code</div>
      <div class="vc-video-wrap">
        <video id="vc-video" playsinline muted></video>
        <div class="vc-scan-overlay">
          <div class="vc-scan-frame"><div class="vc-scan-line"></div></div>
        </div>
      </div>
      <div class="vc-status" id="vc-status">Aim camera at the QR code on your voucher…</div>
      <button class="vc-manual-link" id="vc-manual-toggle">Can't scan? Enter code manually</button>
      <div class="vc-manual-wrap" id="vc-manual-wrap" style="display:none">
        <input type="text" id="vc-manual-input" placeholder="Type voucher code" autocomplete="off">
        <button class="btn sm" id="vc-manual-submit">Check</button>
      </div>
    </div>
  `;

  document.getElementById('vc-manual-toggle').onclick = () => {
    const w = document.getElementById('vc-manual-wrap');
    const shown = w.style.display !== 'none';
    w.style.display = shown ? 'none' : '';
    if (!shown) document.getElementById('vc-manual-input').focus();
  };

  document.getElementById('vc-manual-submit').onclick = () => {
    const val = document.getElementById('vc-manual-input')?.value?.trim();
    if (val) lookupQr(val);
  };

  document.getElementById('vc-manual-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) lookupQr(val);
    }
  });

  const video = document.getElementById('vc-video');
  if (video) {
    scanner = new Scanner(video, (qr) => lookupQr(qr));
    scanner.start().catch((e) => {
      const stat = document.getElementById('vc-status');
      if (stat) stat.textContent = 'Camera unavailable — enter code manually';
      document.getElementById('vc-manual-wrap').style.display = '';
    });
  }
}

async function lookupQr(qr) {
  if (scanner) { scanner.stop(); scanner = null; }

  const stat = document.getElementById('vc-status');
  if (stat) stat.textContent = 'Looking up…';

  try {
    const res  = await fetch(`/api/voucher/status?qr=${encodeURIComponent(qr)}`);
    const data = await res.json();
    renderResult(data.voucher_status ?? 'unknown', data);
  } catch {
    renderResult('unknown', {});
  }
}

function renderResult(status, data) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;

  wrap.innerHTML = `
    <div class="vc-result ${escAttr(status)}">
      <div class="vc-result-icon">${cfg.icon}</div>
      <div class="vc-result-title">${escHtml(cfg.title)}</div>
      <div class="vc-result-body">${escHtml(cfg.body(data))}</div>
    </div>
    <button class="btn" id="vc-scan-again">Scan another voucher</button>
  `;

  document.getElementById('vc-scan-again').onclick = renderScanner;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/[^a-z0-9_-]/gi, '');
}

// Boot — if a qr= param is already in the URL (QR code was a direct link),
// skip the scanner and look it up immediately.
const _preloadQr = new URLSearchParams(window.location.search).get('qr');
if (_preloadQr) {
  lookupQr(_preloadQr);
} else {
  renderScanner();
}
