const assert = require('node:assert/strict');

module.exports = async function verifyHelpTheme({ send, evaluate, waitFor, navigate, screenshot, setCookie, cookie, patientCookie }) {
  const media = scheme => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: scheme }] });
  const width = size => send('Emulation.setDeviceMetricsOverride', { width: size, height: size < 768 ? 844 : 1000, deviceScaleFactor: 1, mobile: size < 768 });
  const clickTheme = () => evaluate('document.querySelector("[data-theme-toggle]").click(); true');
  const luminance = rgb => {
    const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrastRatio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const assertLayout = async route => {
    const layout = await evaluate('({width:innerWidth,content:document.documentElement.scrollWidth,controls:[...document.querySelectorAll(".utility-button")].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}})})');
    assert(layout.content <= layout.width + 1, route + ': rolagem horizontal: ' + JSON.stringify(layout));
    assert.equal(layout.controls.length, 2, route + ': controles de ajuda/tema duplicados ou ausentes');
    assert(layout.controls.every(r => r.left >= 0 && r.right <= layout.width + 1), route + ': controles fora da tela');
  };
  await send('Network.clearBrowserCookies');
  await navigate('/ajuda.html');
  await evaluate('localStorage.removeItem("sgcp_theme"); localStorage.removeItem("sgcp_high_contrast"); localStorage.setItem("sgcp_cookie_preferences_v1", "rejected"); true');
  await media('dark');
  await navigate('/ajuda.html?publico=equipe');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(20, 25, 31)');
  assert(await evaluate('document.querySelector("#helpReturn").getAttribute("href") === "/interno.html"'));
  assert.equal(await evaluate('document.querySelectorAll("[data-help-item][data-audience=\\"pacientes\\"]:not([hidden])").length'), 0);
  const query = value => evaluate('document.querySelector("#helpSearch").value=' + JSON.stringify(value) + '; document.querySelector("#helpSearch").dispatchEvent(new Event("input")); true');
  await query('notificacoes');
  assert(await evaluate('[...document.querySelectorAll("[data-help-item]:not([hidden])")].some(e=>e.textContent.includes("Notificações"))'));
  await query('zzzzassuntoinexistente');
  assert.equal(await evaluate('document.querySelector("#helpEmpty").hidden'), false);
  await evaluate('document.querySelector("#helpReset").click(); true');
  assert.equal(await evaluate('document.querySelectorAll("[data-help-item]:not([hidden])").length'), 24);
  assert.equal(await evaluate('document.activeElement.id'), 'helpSearch');
  await evaluate('document.querySelector("[data-help-audience=\\"pacientes\\"]").click(); true');
  assert.equal(await evaluate('document.querySelectorAll("[data-help-item][data-audience=\\"equipe\\"]:not([hidden])").length'), 0);
  await query('REMARCAÇÃO');
  assert(await evaluate('document.querySelectorAll("[data-help-item]:not([hidden])").length > 0'));
  await evaluate('document.querySelector("#helpClear").click(); document.querySelector(".help-faq:not([hidden]) summary").focus(); true');
  assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor('document.activeElement.parentElement.open');
  if (await evaluate('document.documentElement.classList.contains("high-contrast")')) await evaluate('document.querySelector(".accessibility-tools button").click(); true');
  await evaluate('document.querySelector(".accessibility-tools button").click(); true');
  const contrast = await evaluate('({enabled: document.documentElement.classList.contains("high-contrast"),pressed:document.querySelector(".accessibility-tools button").getAttribute("aria-pressed"),background:getComputedStyle(document.body).backgroundColor})');
  assert(contrast.enabled && contrast.pressed === 'true' && contrast.background === 'rgb(0, 0, 0)', JSON.stringify(contrast));
  await evaluate('document.querySelector(".accessibility-tools button").click(); true');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(20, 25, 31)');
  await clickTheme();
  assert.equal(await evaluate('localStorage.getItem("sgcp_theme")'), 'light');
  await navigate('/login.html');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  await media('light');
  await clickTheme();
  assert.equal(await evaluate('localStorage.getItem("sgcp_theme")'), 'dark');

  let layouts = 0;
  const publicPages = ['/', '/login.html', '/cadastro.html', '/agendar.html', '/setup.html', '/termos.html', '/privacidade.html', '/ajuda.html', '/pagina-inexistente'];
  for (const size of [360, 768, 1024, 1440]) {
    await width(size);
    await send('Network.clearBrowserCookies');
    for (const route of publicPages) {
      if (route === '/setup.html') {
        // The configured test clinic must redirect setup back to login.
        await send('Page.navigate', { url: new URL('/setup.html', await evaluate('location.href')).href });
        await waitFor('location.pathname === "/login.html" && document.readyState === "complete" && !!document.querySelector(".accessibility-tools")');
      } else await navigate(route);
      assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
      await assertLayout(route);
      layouts++;
    }
    await setCookie(cookie);
    await navigate('/interno.html');
    await waitFor('!!document.querySelector("#overviewStats article")');
    await assertLayout('/interno.html');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#overviewStats article")).backgroundColor'), 'rgb(29, 36, 45)');
    const tableColors = await evaluate('({text:getComputedStyle(document.querySelector("#overviewAppointments td")).color,surface:getComputedStyle(document.querySelector(".dashboard-appointments")).backgroundColor})');
    assert(contrastRatio(tableColors.text, tableColors.surface) >= 4.5, 'Contraste insuficiente na tabela do dashboard: ' + JSON.stringify(tableColors));
    if (size === 1440) await screenshot('dark-dashboard-desktop');
    if (size === 360) await screenshot('dark-dashboard-mobile');
    assert(await evaluate('document.querySelector(".topbar-account .utility-actions a").href.includes("publico=equipe")'));
    await setCookie(patientCookie);
    await navigate('/portal.html');
    await waitFor('!!document.querySelector("#portalServices button")');
    await assertLayout('/portal.html');
    if (size === 360) {
      await screenshot('dark-portal-mobile');
      await evaluate('document.querySelector("[data-portal-tab=\\"perfil\\"]").click(); document.querySelector("#profileName").value="Paciente Tema"; document.querySelector("#profileBirth").value="1990-01-01"; document.querySelector("#profileForm").requestSubmit(); true');
      await waitFor('document.querySelector("#profileMessage").textContent === "Dados atualizados."');
      await evaluate('document.querySelector("[data-portal-tab=\\"agendar\\"]").click(); true');
      await waitFor('!!document.querySelector("#portalServices button") && document.querySelector("#portalServices").getAttribute("aria-busy") !== "true"');
      assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".portal-service-choice")).backgroundColor'), 'rgb(255, 255, 255)');
      await screenshot('dark-patient-booking-mobile');
    }
    layouts += 2;
  }
  await send('Network.clearBrowserCookies');
  await navigate('/ajuda.html');
  await screenshot('help-dark-desktop');
  await clickTheme();
  await screenshot('help-light-desktop');
  await width(360);
  await navigate('/ajuda.html?publico=pacientes');
  await assertLayout('/ajuda.html');
  await clickTheme();
  await screenshot('help-dark-mobile');
  await query('senha');
  await evaluate('document.querySelector(".help-faq:not([hidden])").open=true; document.querySelector("#helpFaq").scrollIntoView(); true');
  await screenshot('help-faq-dark-mobile');
  await navigate('/cadastro.html');
  await screenshot('dark-registration-mobile');
  // Choosing a theme must still work if browser storage is unavailable.
  const injected = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Storage unavailable","SecurityError")}});' });
  await navigate('/ajuda.html');
  const initial = await evaluate('document.documentElement.dataset.theme');
  await clickTheme();
  assert.notEqual(await evaluate('document.documentElement.dataset.theme'), initial);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  console.log('OK: central de ajuda, busca sem acentos, públicos, FAQ por teclado, modo escuro/claro, preferência do aparelho, persistência e ' + layouts + ' layouts em modo escuro.');
};
