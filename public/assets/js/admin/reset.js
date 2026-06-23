/**
 * Admin reset section — pre-event or end-of-event data reset.
 */

import { post } from '../api.js?v=1.0.1';

let _toast;

export function initReset(container, toast) {
  _toast = toast;
  render(container);
}

function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Reset / New Event</div>
        <div class="page-subtitle">Selectively clear event data before build or at end of event</div>
      </div>
    </div>

    <div class="form-card" style="border-left:3px solid var(--danger,#c0392b)">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;color:var(--danger,#c0392b);font-weight:600">
        <span style="font-size:1.2em">⚠</span> These actions cannot be undone
      </div>

      <div style="display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.5rem">

        <label class="reset-option">
          <input type="checkbox" id="reset-release-barrio" onchange="window._reset.syncCheckboxes(this)">
          <div>
            <div style="font-weight:500">Release barrio-level checkouts</div>
            <div style="color:var(--text2);font-size:13px;margin-top:2px">
              Clears barrio, artist, and person assignments from all equipment.
              Department assignments are preserved (departments may already have pre-ordered gear).
            </div>
          </div>
        </label>

        <label class="reset-option" style="margin-left:1.5rem">
          <input type="checkbox" id="reset-release-all" onchange="window._reset.syncCheckboxes(this)">
          <div>
            <div style="font-weight:500">…also release department-level checkouts</div>
            <div style="color:var(--text2);font-size:13px;margin-top:2px">
              Also clears department assignments and marks all non-retired equipment as available.
              Use this for a full end-of-event wipe.
            </div>
          </div>
        </label>

        <label class="reset-option">
          <input type="checkbox" id="reset-barrio-status">
          <div>
            <div style="font-weight:500">Reset barrio arrival statuses</div>
            <div style="color:var(--text2);font-size:13px;margin-top:2px">
              Sets all barrios back to "Expected". Clears arrived/departed timestamps and orientation flags.
            </div>
          </div>
        </label>

        <label class="reset-option">
          <input type="checkbox" id="reset-distributions">
          <div>
            <div style="font-weight:500">Clear consumable distributions</div>
            <div style="color:var(--text2);font-size:13px;margin-top:2px">
              Resets distributed counts to zero. Deletes distribution event log.
              Purchased quantities (entitlements) are preserved.
            </div>
          </div>
        </label>

        <label class="reset-option">
          <input type="checkbox" id="reset-transactions">
          <div>
            <div style="font-weight:500">Clear transaction history</div>
            <div style="color:var(--text2);font-size:13px;margin-top:2px">
              Deletes all checkout and checkin records from the audit log.
            </div>
          </div>
        </label>

      </div>

      <div class="field" style="margin-bottom:1rem">
        <label for="reset-confirm-input" style="font-size:13px">
          Type <strong>RESET</strong> to confirm
        </label>
        <input type="text" id="reset-confirm-input" placeholder="RESET"
          style="max-width:200px;font-family:monospace"
          oninput="window._reset.checkConfirm()">
      </div>

      <button class="btn danger sm" id="reset-submit-btn" disabled
        onclick="window._reset.run()">
        Reset selected
      </button>
    </div>
  `;

  window._reset = { syncCheckboxes, checkConfirm, run };
}

function syncCheckboxes(changed) {
  const barrio = document.getElementById('reset-release-barrio');
  const all    = document.getElementById('reset-release-all');
  if (changed === all && all.checked) {
    barrio.checked = true;
  }
  if (changed === barrio && !barrio.checked) {
    all.checked = false;
  }
  checkConfirm();
}

function checkConfirm() {
  const val     = document.getElementById('reset-confirm-input')?.value.trim();
  const anyBox  = ['reset-release-barrio','reset-barrio-status','reset-distributions','reset-transactions']
    .some(id => document.getElementById(id)?.checked);
  const btn = document.getElementById('reset-submit-btn');
  if (btn) btn.disabled = !(val === 'RESET' && anyBox);
}

async function run() {
  const releaseBarrio  = document.getElementById('reset-release-barrio')?.checked;
  const releaseAll     = document.getElementById('reset-release-all')?.checked;
  const barrioStatus   = document.getElementById('reset-barrio-status')?.checked;
  const distributions  = document.getElementById('reset-distributions')?.checked;
  const transactions   = document.getElementById('reset-transactions')?.checked;

  if (!releaseBarrio && !barrioStatus && !distributions && !transactions) {
    _toast('Select at least one option');
    return;
  }

  const btn = document.getElementById('reset-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Resetting…'; }

  try {
    const data = await post('/admin/system/reset', {
      release_barrio:      releaseBarrio && !releaseAll,
      release_all:         releaseAll,
      reset_barrio_status: barrioStatus,
      clear_distributions: distributions,
      clear_transactions:  transactions,
    });

    const r = data.result || {};
    const parts = [];
    if (r.items_released    != null) parts.push(`${r.items_released} item${r.items_released === 1 ? '' : 's'} released`);
    if (r.barrios_reset     != null) parts.push(`${r.barrios_reset} barrio${r.barrios_reset === 1 ? '' : 's'} reset`);
    if (r.entitlements_cleared != null) parts.push(`distributions cleared`);
    if (r.transactions_deleted != null) parts.push(`${r.transactions_deleted} transaction${r.transactions_deleted === 1 ? '' : 's'} deleted`);

    _toast('Done: ' + (parts.join(', ') || 'nothing changed'));

    // Reset the form
    ['reset-release-barrio','reset-release-all','reset-barrio-status','reset-distributions','reset-transactions']
      .forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    const inp = document.getElementById('reset-confirm-input');
    if (inp) inp.value = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Reset selected'; }

  } catch (e) {
    _toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Reset selected'; }
  }
}
