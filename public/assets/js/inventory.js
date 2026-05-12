/**
 * Inventory tab — shows all active items with status.
 */

import { get } from './api.js?v=1.0.1';
import { toast } from './app.js?v=1.0.1';
import { t } from './i18n.js?v=1.0.0';

const __ = (key) => t('inventory', key);
const _c = (key) => t('common', key);

export async function init(container) {
  container.innerHTML = `
    <div class="stats" id="inv-stats">
      <div class="stat-card"><div class="stat-label" id="inv-lbl-avail">${__('colStatus')}</div><div class="stat-val" id="inv-avail">—</div></div>
      <div class="stat-card"><div class="stat-label" id="inv-lbl-out">${_c('statusCheckedOut')}</div><div class="stat-val" id="inv-out">—</div></div>
    </div>
    <div class="section-actions">
      <div style="font-size:13px;color:var(--text2)" id="inv-title">${__('title')}</div>
      <button class="btn sm" onclick="window._inv.refresh()">${_c('refresh')}</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div id="inv-body"><div class="empty">${__('emptyHint')}</div></div>
    </div>
  `;
  window._inv = { refresh: load };
  await load();
}

async function load() {
  const body = document.getElementById('inv-body');
  if (body) body.innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>';

  // Refresh stat card labels (in case language changed since init)
  const lblAvail = document.getElementById('inv-lbl-avail');
  const lblOut   = document.getElementById('inv-lbl-out');
  const title    = document.getElementById('inv-title');
  if (lblAvail) lblAvail.textContent = _c('statusAvailable');
  if (lblOut)   lblOut.textContent   = _c('statusCheckedOut');
  if (title)    title.textContent    = __('title');

  try {
    const data  = await get('/inventory');
    const items = data.items || [];
    const stats = data.stats;

    const avail = document.getElementById('inv-avail');
    const out   = document.getElementById('inv-out');
    if (avail) avail.textContent = stats.available;
    if (out)   out.textContent   = stats.checked_out;

    if (!body) return;
    if (!items.length) {
      body.innerHTML = `<div class="empty">${__('empty')}</div>`;
      return;
    }

    body.innerHTML = `
      <table class="inv-table">
        <thead>
          <tr>
            <th>${__('colItem')}</th>
            <th>${__('colStatus')}</th>
            <th>${__('colBarrio')}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>
                <div style="font-size:14px">${it.name}</div>
                ${it.category ? `<div style="font-size:11px;color:var(--text3)">${it.category}</div>` : ''}
              </td>
              <td>
                ${it.status === 'available'
                  ? `<span class="pill available"><span class="dot g"></span>${_c('statusAvailable')}</span>`
                  : `<span class="pill out"><span class="dot a"></span>${_c('statusOut')}</span>`
                }
              </td>
              <td style="color:var(--text2);font-size:13px">${it.current_barrio ?? '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    if (body) body.innerHTML = `<div class="empty">${__('failed')}</div>`;
    toast('Inventory error: ' + e.message);
  }
}
