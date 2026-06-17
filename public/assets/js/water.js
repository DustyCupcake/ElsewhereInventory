import { initLang, t, renderSwitcher, onLangChange } from './i18n.js?v=1.0.0';

initLang();
renderSwitcher(document.getElementById('lang-switcher'));
onLangChange(render);
render();

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

  document.title = `${w('pageTitle')} — Elsewhere Inventory`;

  document.getElementById('water-main').innerHTML = `

    <div class="w-hero">
      <div class="w-hero-icon">💧</div>
      <h1>${esc(w('pageTitle'))}</h1>
      <p>${esc(w('pageSubtitle'))}</p>
    </div>

    <!-- How to read the sign -->
    <section class="w-section">
      <div class="w-section-title">${esc(w('readTitle'))}</div>
      <div class="w-about-card">${esc(w('readDials'))}</div>
      <div class="w-about-card">${esc(w('readStrips'))}</div>
    </section>

    <!-- How sanitation works -->
    <section class="w-section">
      <div class="w-section-title">${esc(w('processTitle'))}</div>
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
            <div class="w-step-text">${esc(w('step2Body'))}</div>
          </div>
        </div>

        <div class="w-step">
          <div class="w-step-num">3</div>
          <div class="w-step-body">
            <div class="w-step-title">${esc(w('step3Title'))}</div>
            <div class="w-step-text">${esc(w('step3Body'))}</div>
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

    <!-- Testing -->
    <section class="w-section">
      <div class="w-section-title">${esc(w('testingTitle'))}</div>
      <div class="w-about-card">${esc(w('testingBody'))}</div>
      <div class="w-deposit-note">${esc(w('testingNoChlorine'))}</div>
    </section>

    <p class="w-footer-note">${esc(c('questions'))}</p>
  `;
}
