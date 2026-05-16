/**
 * Scan In tab — return equipment or validate vouchers.
 */

import { get, post } from './api.js?v=1.0.1';
import { Scanner } from './scanner.js?v=1.0.0';
import { toast, getCurrentUser } from './app.js?v=1.0.1';
import { scanOverlay } from './scan-overlay.js?v=1.0.0';
import { init as initValidate, destroy as destroyValidate } from './validate.js?v=1.0.1';
import { init as initActivate, destroy as destroyActivate } from './activate.js?v=1.0.0';
import { t } from './i18n.js?v=1.0.0';

const __ = (key) => t('checkin', key);
const _c = (key) => t('common', key);

let scanner      = null;
let lastItem     = null;
let mode         = 'return'; // 'return' | 'validate' | 'activate'

export function init(container) {
  render(container);
}

export function destroy() {
  if (scanner) { scanner.stop(); scanner = null; }
  destroyValidate();
  destroyActivate();
}

function render(container) {
  lastItem = null;

  const toggleHTML = `
    <div class="mode-toggle-wrap">
      <div class="mode-toggle">
        <button ${mode === 'return'   ? 'class="active"' : ''} onclick="window._ci.setMode('return')">${__('modeReturn')}</button>
        <button ${mode === 'validate' ? 'class="active"' : ''} onclick="window._ci.setMode('validate')">${__('modeVoucher')}</button>
        <button ${mode === 'activate' ? 'class="active"' : ''} onclick="window._ci.setMode('activate')">${__('modeActivate')}</button>
      </div>
    </div>
  `;

  window._ci = { setMode: (v) => setMode(v, container) };

  if (mode === 'validate') {
    container.innerHTML = toggleHTML;
    const inner = document.createElement('div');
    container.appendChild(inner);
    initValidate(inner, false);
    return;
  }

  if (mode === 'activate') {
    container.innerHTML = toggleHTML;
    const inner = document.createElement('div');
    container.appendChild(inner);
    initActivate(inner);
    return;
  }

  if (scanner) { scanner.stop(); scanner = null; }

  container.innerHTML = toggleHTML + `
    <div class="card">
      <div class="card-label">Scan item to return</div>
      <div class="video-wrap" id="ci-video-wrap">
        <video id="ci-video" playsinline muted></video>
        <div class="scan-overlay"><div class="scan-frame"><div class="scan-line"></div></div></div>
      </div>
      <div class="scan-status" id="ci-status">${_c('aimCamera')}</div>
    </div>
  `;

  startScanner(container);
}

function setMode(v, container) {
  mode = v;
  destroyValidate();
  destroyActivate();
  if (scanner) { scanner.stop(); scanner = null; }
  render(container);
}

async function startScanner(container) {
  const video = document.getElementById('ci-video');
  if (!video) return;
  scanner = new Scanner(video, (qr) => handleScan(qr, container));
  try {
    await scanner.start();
  } catch (e) {
    const stat = document.getElementById('ci-status');
    if (stat) stat.textContent = _c('cameraError');
  }
}

function _checkedOutTo(item) {
  if (item.current_person) return `${__('checkedOutTo')} ${item.current_person.name}`;
  if (item.current_barrio) return `${__('checkedOutTo')} ${item.current_barrio.name}`;
  if (item.current_artist) return `${__('checkedOutTo')} ${item.current_artist.name}`;
  if (item.current_dept)   return `${__('inDeptPool')} ${item.current_dept.name}`;
  return item.category ?? null;
}

function _borrowReasonText(reason) {
  if (reason === 'restricted')      return __('borrowRestricted');
  if (reason === 'no_permission')   return __('borrowNoPermission');
  if (reason === 'shift_session')   return __('borrowShiftSession');
  if (reason === 'not_borrowable')  return __('borrowNotBorrowable');
  return __('borrowNotEligible');
}

async function handleScan(qr, container) {
  const stat = document.getElementById('ci-status');
  if (stat) stat.textContent = _c('lookingUp');

  const doReset = () => {
    scanOverlay.hide();
    render(container);
  };

  const doConfirmReturn = async () => {
    scanOverlay.hide();
    await confirmCheckin(qr, container);
  };

  try {
    let item;

    if (!navigator.onLine) {
      const cached = localStorage.getItem('barrio_item:' + qr);
      if (cached) item = JSON.parse(cached);
    }

    if (!item) {
      item = await get('/items/lookup', { qr });
      try { localStorage.setItem('barrio_item:' + qr, JSON.stringify(item)); } catch {}
    }

    lastItem = item;

    if (item.status === 'available') {
      if (item.borrowable && item.borrow_eligible) {
        // Item can be borrowed — offer person checkout
        scanOverlay.show({
          state: 'success',
          title: item.name,
          subtitle: __('availableForBorrow'),
          buttons: [
            { label: __('borrowCheckOut'), action: () => startPersonBorrowFlow(item, container, false) },
            { label: _c('cancel'),         action: doReset },
          ],
        });
      } else if (item.borrowable && !item.borrow_eligible) {
        // Borrowable type but this user can't borrow it
        scanOverlay.show({
          state: 'warning',
          title: item.name,
          subtitle: _borrowReasonText(item.borrow_reason),
          buttons: [{ label: _c('ok'), action: doReset }],
        });
      } else {
        // Not borrowable — just "already returned"
        scanOverlay.show({
          state: 'warning',
          title: item.name,
          subtitle: __('alreadyReturned'),
          buttons: [{ label: _c('ok'), action: doReset }],
        });
      }
    } else {
      const subtitle = _checkedOutTo(item);
      const buttons  = [];

      // If checked out to a person and user can borrow, offer transfer
      if (item.current_person && item.borrowable && item.borrow_eligible) {
        buttons.push({ label: __('confirmReturn'), action: doConfirmReturn });
        buttons.push({ label: __('borrowTransfer'), action: () => startPersonBorrowFlow(item, container, true) });
        buttons.push({ label: _c('undo'), action: doReset });
      } else {
        buttons.push({ label: __('confirmReturn'), action: doConfirmReturn });
        buttons.push({ label: _c('undo'),          action: doReset });
      }

      scanOverlay.show({
        state: 'success',
        title: item.name,
        subtitle,
        buttons,
      });
    }
  } catch (e) {
    const doManual = () => {
      scanOverlay.showManualEntry({
        placeholder: _c('enterManually'),
        onSubmit: (typed) => handleScan(typed, container),
        onCancel: doReset,
      });
    };

    if (!e.status && !navigator.onLine) {
      scanOverlay.show({
        state: 'warning',
        title: _c('offline'),
        subtitle: __('unavailableQueue'),
        buttons: [
          { label: __('returnAnyway'), action: doConfirmReturn },
          { label: _c('cancel'),       action: doReset },
        ],
      });
      return;
    }

    scanOverlay.show({
      state: 'error',
      title: _c('notFound'),
      subtitle: e.status === 404 ? _c('notFound') : _c('lookingUp'),
      buttons: [
        { label: _c('ok'),            action: doReset },
        { label: _c('enterManually'), action: doManual },
      ],
    });

    toast(e.message);
  }
}

async function confirmCheckin(qr, container) {
  try {
    const res = await post('/checkin', { item_qr: qr });
    if (res.__offline) {
      toast(_c('offlineSaved'));
    } else if (res.success) {
      toast(__('returned').replace('[NAME]', lastItem?.name ?? qr));
    } else {
      toast(__('notCheckedOut'));
    }
  } catch (e) {
    toast('Error: ' + e.message);
  }

  render(container);
}

// ─── Person borrow flow ───────────────────────────────────────────────────────

function startPersonBorrowFlow(item, container, isTransfer) {
  scanOverlay.hide();
  if (scanner) { scanner.stop(); scanner = null; }

  const label = isTransfer ? __('borrowTransfer') : __('borrowCheckOut');

  container.innerHTML = `
    <div class="card">
      <div class="card-label">${label}: ${item.name}</div>
      <input class="search-input" id="borrow-search" type="search"
        placeholder="${__('borrowSearchPlaceholder')}" autocomplete="off" autocorrect="off" spellcheck="false">
      <div id="borrow-results" class="search-results"></div>
    </div>
    <button class="btn-ghost" id="borrow-cancel" style="margin-top:1rem">${_c('cancel')}</button>
  `;

  document.getElementById('borrow-cancel').addEventListener('click', () => render(container));

  let searchTimeout;
  const searchInput = document.getElementById('borrow-search');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    const resultsEl = document.getElementById('borrow-results');
    if (!resultsEl) return;
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    searchTimeout = setTimeout(() => doPersonSearch(q, item, container, isTransfer), 300);
  });

  setTimeout(() => searchInput.focus(), 60);
}

async function doPersonSearch(q, item, container, isTransfer) {
  const resultsEl = document.getElementById('borrow-results');
  if (!resultsEl) return;

  try {
    const data    = await get('/persons', { q });
    const persons = data.persons || [];

    if (!persons.length) {
      resultsEl.innerHTML = `<div class="search-no-results">${_c('noResults')}</div>`;
      return;
    }

    resultsEl.innerHTML = persons.map(p =>
      `<button class="search-result-item" data-id="${p.id}" data-qr="${p.qr_token}"
        data-name="${p.display_name.replace(/"/g, '&quot;')}">${p.display_name}</button>`
    ).join('');

    resultsEl.querySelectorAll('.search-result-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const person = { id: +btn.dataset.id, qr_token: btn.dataset.qr, display_name: btn.dataset.name };
        confirmPersonBorrow(item, person, container, isTransfer);
      });
    });
  } catch (e) {
    resultsEl.innerHTML = `<div class="search-no-results">${_c('error') ?? 'Error'}</div>`;
  }
}

function confirmPersonBorrow(item, person, container, isTransfer) {
  const action = isTransfer ? __('borrowTransfer') : __('borrowCheckOut');
  scanOverlay.show({
    state: 'success',
    title: item.name,
    subtitle: `${action}: ${person.display_name}`,
    buttons: [
      { label: _c('confirm'), action: () => doPersonBorrow(item, person, container) },
      { label: _c('cancel'),  action: () => startPersonBorrowFlow(item, container, isTransfer) },
    ],
  });
}

async function doPersonBorrow(item, person, container) {
  scanOverlay.hide();
  try {
    const user  = getCurrentUser();
    const perms = user?.permissions || [];
    let result;

    if (perms.includes('checkout_equipment')) {
      result = await post('/person-checkout', {
        person_qr: person.qr_token,
        item_qrs:  [item.qr_code],
        force:     true,
      });
    } else {
      const deptId = (user?.dept_ids || [])[0];
      result = await post('/sub-person-checkout', {
        dept_id:   deptId,
        person_qr: person.qr_token,
        item_qrs:  [item.qr_code],
        force:     true,
      });
    }

    if (result.success !== false) {
      toast(__('borrowDone').replace('[PERSON]', person.display_name));
    }
  } catch (e) {
    toast('Error: ' + e.message);
  }

  render(container);
}
