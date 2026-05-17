import { switchTab } from './app.js?v=1.0.3';

export function init(container, user) {
  const perms = user?.permissions || [];
  render(container, perms);
}

function render(container, perms) {
  const has = p => perms.includes(p);

  const secondaryBtns = buildSecondary(perms);

  container.innerHTML = `
    <div class="home-wrap">
      <button class="home-scan-btn" id="home-scan-btn">
        <span class="home-scan-icon">&#x1F4F7;</span> Scan
      </button>
      ${buildSecondaryHtml(secondaryBtns)}
    </div>`;

  document.getElementById('home-scan-btn')?.addEventListener('click', () => switchTab('scanner'));

  container.querySelectorAll('.home-sec-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function buildSecondary(perms) {
  const has = p => perms.includes(p);
  const btns = [];

  // Production staff: manual dept checkout (no dept QR needed)
  if (has('checkout_equipment')) {
    btns.push({ tab: 'checkout', label: 'Lend to team', sub: 'Choose dept manually' });
  }

  return btns;
}

function buildSecondaryHtml(btns) {
  if (!btns.length) return '';
  return `<div class="home-secondary">
    ${btns.map(b => `
      <button class="home-sec-btn" data-tab="${b.tab}">
        ${b.label}
        <span class="home-sec-sub">${b.sub}</span>
      </button>`).join('')}
  </div>`;
}
