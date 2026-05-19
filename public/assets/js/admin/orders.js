/**
 * Admin orders section — aggregate pivot view + shareable form link.
 * Requires manage_orders permission (production_admin).
 */

import { get } from '../api.js?v=1.0.1';

export async function initOrders(container, toast) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Equipment Orders</div>
        <div class="page-subtitle" id="orders-subtitle">Loading…</div>
      </div>
      <button class="btn sm" id="orders-copy-link-btn">Copy form link</button>
    </div>
    <div id="orders-body"><div class="empty"><span class="spinner"></span> Loading…</div></div>
  `;

  document.getElementById('orders-copy-link-btn')?.addEventListener('click', () => {
    const url = window.location.origin + '/?tab=orders';
    navigator.clipboard.writeText(url).then(
      () => toast('Link copied: ' + url),
      () => toast('Copy failed — link: ' + url)
    );
  });

  try {
    const data = await get('/admin/dept-orders');
    renderTable(container, data, toast);
  } catch (e) {
    container.querySelector('#orders-body').innerHTML =
      `<div class="empty-list">Could not load orders: ${_esc(e.message)}</div>`;
    const sub = document.getElementById('orders-subtitle');
    if (sub) sub.textContent = '';
  }
}

function renderTable(container, data, toast) {
  const body  = container.querySelector('#orders-body');
  const depts = data.departments || [];
  const types = data.types       || [];
  const pivot = data.pivot       || {};

  const deptsWithOrders = depts.filter(d =>
    types.some(t => (pivot[t.id]?.[d.id] || 0) > 0)
  ).length;

  const sub = document.getElementById('orders-subtitle');
  if (sub) {
    sub.textContent = depts.length
      ? `${deptsWithOrders} of ${depts.length} team${depts.length !== 1 ? 's' : ''} have submitted orders`
      : 'No teams configured';
  }

  if (!types.length) {
    body.innerHTML = `<div class="empty-list">No equipment types configured for ordering.</div>`;
    return;
  }

  const deptCols = depts.map(d =>
    `<th style="text-align:center;font-size:11px">${_esc(d.name)}</th>`
  ).join('');

  const tableRows = types.map(t => {
    const typePivot = pivot[t.id] || {};
    const total = depts.reduce((sum, d) => sum + (typePivot[d.id] || 0), 0);
    const deptQtys = depts.map(d => {
      const qty = typePivot[d.id] || 0;
      return `<td style="text-align:center;color:${qty ? 'var(--text)' : 'var(--text3)'}">${qty || '—'}</td>`;
    }).join('');
    return `
      <tr>
        <td>${_esc(t.name)}</td>
        <td style="text-align:center;font-weight:600">${total || '—'}</td>
        ${deptQtys}
      </tr>
    `;
  }).join('');

  body.innerHTML = `
    <div style="overflow-x:auto">
      <table class="data-table" style="min-width:400px">
        <thead>
          <tr>
            <th>Equipment type</th>
            <th style="text-align:center">Total</th>
            ${deptCols}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
