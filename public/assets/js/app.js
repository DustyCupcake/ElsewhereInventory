/**
 * Main entry point for the staff checkout app.
 * Handles session check, tab routing, and toast notifications.
 */

import { get, post, setCsrf } from './api.js?v=1.0.1';
import { initOfflineSync } from './offline.js?v=1.0.0';
import { init as initCheckout } from './checkout.js?v=1.0.1';
import { init as initCheckin, destroy as destroyCheckin } from './checkin.js?v=1.0.2';
import { init as initBarrios, destroy as destroyBarrios } from './barrios.js?v=1.0.1';
import { init as initInventory } from './inventory.js?v=1.0.0';
import { init as initHistory } from './history.js?v=1.0.0';
import { init as initValidate, destroy as destroyValidate } from './validate.js?v=1.0.1';
import { initLang, applyTranslations, renderSwitcher, onLangChange, setLang, getLang } from './i18n.js?v=1.0.0';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js?v=1.0.0').catch(() => {});
}

// Initialise language as early as possible (before DOM renders)
initLang();

let currentTab     = null;
let toastTimer     = null;
let _currentUser   = null;

export function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

async function boot() {
  // Apply translations to static HTML (nav labels, etc.) immediately
  applyTranslations();
  renderSwitcher(document.getElementById('lang-switcher'));

  // When language changes: re-apply static strings, re-render current tab,
  // and persist the preference to the server (fire-and-forget).
  onLangChange(() => {
    applyTranslations();
    rerenderCurrentTab();
    if (_currentUser) {
      post('/auth/language', { lang: getLang() }).catch(() => {});
    }
  });

  // Verify session; redirect to login if expired
  let user;
  try {
    user = await get('/auth/me');
    setCsrf(user.csrf_token);
    try { localStorage.setItem('barrio_user', JSON.stringify(user)); } catch {}
  } catch {
    if (!navigator.onLine) {
      try {
        const cached = localStorage.getItem('barrio_user');
        if (cached) user = JSON.parse(cached);
      } catch {}
    }
    if (!user) {
      window.location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
  }

  _currentUser = user;

  // Apply user's stored language preference (overrides browser/localStorage if different)
  if (user.language) setLang(user.language);

  // Show user info in header
  const userEl = document.getElementById('header-user');
  if (userEl) userEl.textContent = user.display_name;

  const adminLink = document.getElementById('admin-link');
  if (adminLink && user.role === 'admin') adminLink.style.display = '';

  // Validator gets a stripped-down single-mode view
  if (user.role === 'validator') {
    bootValidator();
    return;
  }

  // Init offline sync
  initOfflineSync(toast);

  // Tab routing
  const tabs = document.querySelectorAll('nav button[data-tab]');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
  });

  const barrioId = new URLSearchParams(location.search).get('barrio') || null;
  switchTab('checkout', barrioId);
}

function bootValidator() {
  // Hide the full nav, show only a minimal header
  const nav = document.querySelector('nav');
  if (nav) nav.style.display = 'none';

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
  });

  // Use the validate panel
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('tab-validate');
  if (panel) {
    panel.style.display = '';
    currentTab = 'validate';
    initValidate(panel, true);
  }
}

/**
 * Re-initialise the currently active tab after a language change.
 * Destroys any stateful scanner/overlay, then re-inits the panel.
 */
function rerenderCurrentTab() {
  if (!currentTab) return;
  // Destroy state for modules that have a destroy function
  if (currentTab === 'checkin')  destroyCheckin();
  if (currentTab === 'barrios')  destroyBarrios();
  if (currentTab === 'validate') destroyValidate();

  const panel = document.getElementById('tab-' + currentTab);
  if (!panel) return;

  switch (currentTab) {
    case 'checkout':  initCheckout(panel, null);  break;
    case 'checkin':   initCheckin(panel);          break;
    case 'barrios':   initBarrios(panel, null);    break;
    case 'inventory': initInventory(panel);        break;
    case 'history':   initHistory(panel);          break;
    case 'validate':  initValidate(panel, true);   break;
  }
}

export function switchTab(name, extra = null) {
  if (currentTab === name && !extra) return;

  // Destroy previous tab state
  if (currentTab === 'checkin') destroyCheckin();
  if (currentTab === 'barrios') destroyBarrios();
  if (currentTab === 'validate') destroyValidate();

  currentTab = name;

  // Update nav
  document.querySelectorAll('nav button[data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });

  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

  const panel = document.getElementById('tab-' + name);
  if (panel) panel.style.display = '';

  switch (name) {
    case 'checkout':  initCheckout(panel, extra);  break;
    case 'checkin':   initCheckin(panel);           break;
    case 'barrios':   initBarrios(panel, extra);    break;
    case 'inventory': initInventory(panel);         break;
    case 'history':   initHistory(panel);           break;
    case 'validate':  initValidate(panel, true);    break;
  }
}

document.addEventListener('DOMContentLoaded', boot);
