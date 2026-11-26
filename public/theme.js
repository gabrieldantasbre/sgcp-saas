(() => {
  const key = 'sgcp_theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  if (!['light', 'dark'].includes(preference)) preference = null;
  const moon = '<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/><path d="M18 2v4m-2-2h4"/>';
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  const svg = content => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + content + '</svg>';
  function apply() {
    const dark = preference ? preference === 'dark' : system.matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    const button = document.querySelector('[data-theme-toggle]');
    if (button) {
      const label = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
      button.innerHTML = svg(dark ? sun : moon);
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(dark));
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14191f' : '#203768');
    window.dispatchEvent(new CustomEvent('sgcp:themechange', { detail: { theme: root.dataset.theme } }));
  }
  // Run in the head, before styles and body paint.
  apply();
  system.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = ['light', 'dark'].includes(event.newValue) ? event.newValue : null;
    apply();
  });
  function mount() {
    const controls = document.createElement('div');
    controls.className = 'utility-actions';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Ajuda e aparência');
    const help = document.createElement('a');
    help.className = 'utility-button';
    help.href = '/ajuda.html?publico=' + (document.body.dataset.page === 'interno' ? 'equipe' : 'pacientes');
    help.setAttribute('aria-label', 'Central de ajuda');
    help.title = 'Central de ajuda';
    help.innerHTML = svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 4.4 1.6c-.9.7-1.9 1.2-1.9 2.9m0 3h.01"/>');
    const button = document.createElement('button');
    button.className = 'utility-button';
    button.type = 'button';
    button.dataset.themeToggle = '';
    button.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch {}
      apply();
    });
    controls.append(help, button);
    const account = document.querySelector('.topbar-account, .portal-account');
    const siteHeader = document.querySelector('.podology-header-inner');
    const header = document.querySelector('.help-header-actions, .public-booking-header');
    if (account) account.insertBefore(controls, account.querySelector('.avatar'));
    else if (siteHeader) {
      siteHeader.classList.add('has-utilities');
      siteHeader.append(controls);
    } else if (header) header.append(controls);
    else {
      controls.classList.add('page-utilities');
      document.querySelector('.auth-card, .privacy-document, .not-found-card, main')?.prepend(controls);
    }
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
