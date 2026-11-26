(() => {
  const key = 'sgcp_cookie_preferences_v1';
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      // Keep existing choices while upgrading to a dated, versioned preference.
      const value = ['accepted', 'rejected'].includes(raw) ? { choice: raw } : JSON.parse(raw);
      return ['accepted', 'rejected'].includes(value?.choice) ? value : null;
    } catch { return null; }
  };
  let preference = read();
  const banner = document.createElement('aside');
  banner.className = 'cookie-banner';
  banner.setAttribute('aria-label', 'Preferências de cookies');
  banner.id = 'cookieBanner';
  banner.innerHTML = '<div><strong>Sua privacidade</strong><p>Usamos o cookie necessário para login e segurança. Você pode RECUSAR cookies opcionais sem perder o acesso. Atualmente não utilizamos cookies opcionais, de análise ou publicidade. <a href="/privacidade.html">Saiba mais</a>.</p></div><div class="cookie-actions"><button type="button" class="button button-outline" data-cookie-choice="rejected">RECUSAR opcionais</button><button type="button" class="button button-outline" data-cookie-choice="accepted">Aceitar opcionais</button></div>';
  banner.hidden = Boolean(preference);
  document.body.append(banner);
  banner.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cookie-choice]');
    if (!button) return;
    preference = { choice: button.dataset.cookieChoice, version: '2026-11-v1', updatedAt: new Date().toISOString() };
    try { localStorage.setItem(key, JSON.stringify(preference)); } catch {}
    window.dispatchEvent(new CustomEvent('cookiepreferenceschange', { detail: button.dataset.cookieChoice }));
    banner.hidden = true;
    preferences.setAttribute('aria-expanded', 'false');
    preferences.focus({ preventScroll: true });
  });
  const preferences = document.createElement('button');
  preferences.type = 'button'; preferences.className = 'cookie-settings'; preferences.textContent = 'Cookies';
  preferences.setAttribute('aria-controls', banner.id);
  preferences.setAttribute('aria-expanded', String(!banner.hidden));
  preferences.addEventListener('click', () => {
    banner.hidden = !banner.hidden;
    preferences.setAttribute('aria-expanded', String(!banner.hidden));
    if (!banner.hidden) banner.querySelector('[data-cookie-choice]').focus();
  });
  banner.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { banner.hidden = true; preferences.setAttribute('aria-expanded', 'false'); preferences.focus(); }
  });
  // Optional integrations must check this explicit opt-in before loading.
  window.sgcpCookies = { allowsOptional: () => preference?.choice === 'accepted' };
  document.body.append(preferences);
})();
