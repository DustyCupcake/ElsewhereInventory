import { initLang, t, renderSwitcher, onLangChange } from './i18n.js?v=1.0.0';

// Times/details that need to be filled in — edit these strings directly.
// Use null to show a styled placeholder instead.
const INFO = {
  depositTime:   null,   // e.g. '14:00' — deadline to drop voucher half at NoInfo
  waterRunTime:  null,   // e.g. '16:00' — when the water run starts
};

initLang();
renderSwitcher(document.getElementById('lang-switcher'));
onLangChange(render);
render();

function ph(value, fallback) {
  if (value) return `<strong>${esc(value)}</strong>`;
  return `<span class="placeholder">${esc(fallback)}</span>`;
}

function inject(str) {
  return str
    .replace('[DEPOSIT_TIME]',   ph(INFO.depositTime,  '[time TBC]'))
    .replace('[WATER_RUN_TIME]', ph(INFO.waterRunTime, '[time TBC]'));
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  const w = (key) => t('water', key);
  const c = (key) => t('common', key);

  document.title = `${w('pageTitle')} — Barrio Support`;

  document.getElementById('water-main').innerHTML = `

    <div class="w-hero">
      <div class="w-hero-icon">💧</div>
      <h1>${esc(w('pageTitle'))}</h1>
      <p>${esc(w('pageSubtitle'))}</p>
    </div>

    <!-- How it works -->
    <section class="w-section">
      <div class="w-section-title">${esc(w('howTitle'))}</div>
      <div class="w-steps">

        <div class="w-step">
          <div class="w-step-num">1</div>
          <div class="w-step-body">
            <div class="w-step-title">${esc(w('step1Title'))}</div>
            <div class="w-step-text">${esc(w('step1Body'))}</div>
          </div>
        </div>

        <div class="w-step">
          <div class="w-step-num">2</div>
          <div class="w-step-body">
            <div class="w-step-title">${esc(w('step2Title'))}</div>
            <div class="w-step-text">${inject(w('step2Body'))}</div>
          </div>
        </div>

        <div class="w-step">
          <div class="w-step-num">3</div>
          <div class="w-step-body">
            <div class="w-step-title">${esc(w('step3Title'))}</div>
            <div class="w-step-text">${inject(w('step3Body'))}</div>
          </div>
        </div>

        <div class="w-step">
          <div class="w-step-num">4</div>
          <div class="w-step-body">
            <div class="w-step-title">${esc(w('step4Title'))}</div>
            <div class="w-step-text">${esc(w('step4Body'))}</div>
          </div>
        </div>

        <div class="w-step">
          <div class="w-step-num">5</div>
          <div class="w-step-body">
            <div class="w-step-title">${esc(w('step5Title'))}</div>
            <div class="w-step-text">${esc(w('step5Body'))}</div>
          </div>
        </div>

      </div>
    </section>

    <!-- About the dual voucher -->
    <section class="w-section">
      <div class="w-section-title">${esc(w('aboutTitle'))}</div>
      <div class="w-about-card">${inject(w('aboutBody'))}</div>
      <div class="w-deposit-note">${inject(w('depositNote'))}</div>
    </section>

    <!-- Check voucher CTA -->
    <section class="w-section">
      <div class="w-cta">
        <div class="w-cta-title">${esc(w('checkTitle'))}</div>
        <div class="w-cta-body">${esc(w('checkBody'))}</div>
        <a href="/voucher" class="btn primary">${esc(c('checkVoucher'))}</a>
      </div>
    </section>

    <p class="w-footer-note">${esc(c('questions'))}</p>
  `;
}
