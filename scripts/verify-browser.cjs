// Optional browser checks, isolated from the user's Chrome profile and clinic database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function verifyBrowser({ url, cookie, patientCookie }) {
  if (!globalThis.WebSocket) throw new Error('A verificação opcional no Chrome exige Node.js 22 ou superior.');
  const executable = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(file => fs.existsSync(file));
  if (!executable) throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH para verificar a interface.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sgcp-browser-'));
  const output = path.join(__dirname, '..', 'artifacts', 'verification');
  fs.mkdirSync(output, { recursive: true });
  const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
    assert(fs.existsSync(portFile), 'Chrome não disponibilizou a porta de teste.');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const tab = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    const errors = [];
    const paused = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Fetch.requestPaused') paused.push(message.params.requestId);
      if (message.id && pending.has(message.id)) {
        const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const number = ++id;
      const timer = setTimeout(() => { pending.delete(number); reject(new Error('Timeout: ' + method)); }, 15000);
      pending.set(number, { resolve, reject, timer }); socket.send(JSON.stringify({ id: number, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
      throw new Error('Condição não atendida: ' + expression);
    };
    const navigate = async route => {
      await send('Page.navigate', { url: url + route });
      await waitFor('location.pathname === ' + JSON.stringify(route.split('?')[0]) + ' && document.readyState === "complete" && !!document.querySelector(".accessibility-tools")');
    };
    const screenshot = async name => {
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
    };
    const setCookie = async value => {
      await send('Network.clearBrowserCookies');
      await send('Network.setCookie', { name: 'sgcp_session', value: value.split('=').slice(1).join('='), url, httpOnly: true, sameSite: 'Lax' });
    };
    console.log('Chrome conectado:', (await send('Browser.getVersion')).product);
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (process.argv.includes('--modules-only')) {
      await require('./verify-module-views.cjs')({ send, evaluate, waitFor, navigate, screenshot, setCookie, cookie });
      assert.deepEqual(errors, [], 'Erros JavaScript nos módulos');
      return;
    }
    const routes = ['/', '/cadastro.html', '/login.html', '/agendar.html', '/termos.html', '/privacidade.html', '/pagina-inexistente'];
    let checks = 0;
    for (const width of [360, 390, 768, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const route of routes) {
        await navigate(route);
        const layout = await evaluate('({width: innerWidth, content: document.documentElement.scrollWidth, missingAlt: document.querySelectorAll("img:not([alt])").length})');
        assert(layout.content <= width + 1, route + ' apresenta rolagem horizontal em ' + width + 'px: ' + JSON.stringify(layout));
        assert.equal(layout.missingAlt, 0, route + ' possui imagem sem alt');
        assert(await evaluate('!!document.querySelector("a[href^=\\"#\\"]") && !!document.querySelector("main")'), route + ' precisa de atalho para o conteúdo');
        checks++;
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate('/');
    await evaluate('localStorage.clear(); location.reload(); true');
    await waitFor('document.readyState === "complete" && !!document.querySelector("[data-cookie-choice=\\"rejected\\"]")');
    assert.equal(await evaluate('document.querySelector(".cookie-banner").hidden'), false);
    await screenshot('mobile-cookie-banner');
    await evaluate('document.querySelector("[data-cookie-choice=\\"rejected\\"]").click(); true');
    assert(await evaluate('JSON.parse(localStorage.getItem("sgcp_cookie_preferences_v1")).choice === "rejected" && !sgcpCookies.allowsOptional()'));
    await navigate('/cadastro.html');
    assert.equal(await evaluate('document.querySelector(".cookie-banner").hidden'), true);
    await evaluate('document.querySelector(".cookie-settings").click(); true');
    assert.equal(await evaluate('document.activeElement.dataset.cookieChoice'), 'rejected');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert(await evaluate('document.querySelector(".cookie-banner").hidden && document.activeElement.classList.contains("cookie-settings")'));
    const fields = await evaluate('Array.from(document.querySelectorAll("#patientRegister input")).map(e => e.id)');
    assert(!fields.includes('registerName') && !fields.includes('registerPhone') && !fields.includes('registerBirth') && !fields.includes('registerAddress'));
    assert.equal(await evaluate('document.querySelector("#termsAccepted").checked'), false);
    await evaluate('document.querySelector("#registerAgeGroup").value="MENOR"; document.querySelector("#registerAgeGroup").dispatchEvent(new Event("change")); true');
    assert(await evaluate('!document.querySelector("#registerGuardianFields").hidden && document.querySelector("#registerGuardianConsent").required && document.querySelector("#registerGuardianRelationship").required'));
    await evaluate('document.querySelector("#registerGuardianFields").scrollIntoView({block: "center"}); true');
    await screenshot('mobile-parental-authorization');
    await evaluate('document.querySelector("#registerAgeGroup").value="ADULTO"; document.querySelector("#registerAgeGroup").dispatchEvent(new Event("change")); document.querySelector(".accessibility-tools button").click(); true');
    assert(await evaluate('document.documentElement.classList.contains("high-contrast") && document.querySelector(".accessibility-tools button").getAttribute("aria-pressed") === "true"'));
    await screenshot('mobile-high-contrast');
    await navigate('/login.html');
    assert(await evaluate('document.documentElement.classList.contains("high-contrast")'));
    await evaluate('document.querySelector(".accessibility-tools button").click(); true');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/catalogo', requestStage: 'Request' }] });
    await navigate('/');
    await waitFor('!!document.querySelector("#publicServices .loading-skeleton")');
    assert(await evaluate('document.querySelector("#publicServices").getAttribute("aria-busy") === "true" && getComputedStyle(document.querySelector(".skeleton-block")).animationDuration === "1e-05s"'));
    await evaluate('document.querySelector("#publicServices").scrollIntoView(); true');
    await screenshot('mobile-skeleton');
    for (const requestId of paused.splice(0)) await send('Fetch.continueRequest', { requestId });
    await send('Fetch.disable');
    await waitFor('!document.querySelector("#publicServices .loading-skeleton") && !document.querySelector("#publicServices").hasAttribute("aria-busy")');
    // The first Tab must reveal the skip link.
    await navigate('/');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert(await evaluate('document.activeElement.textContent.includes("Pular para o conteúdo")'));
    await evaluate('document.querySelector("[data-site-menu]").click(); true');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert(await evaluate('document.querySelector("[data-site-menu]").getAttribute("aria-expanded") === "false" && document.activeElement.hasAttribute("data-site-menu")'));
    await navigate('/agendar.html');
    await waitFor('document.querySelector("#publicProcedure").options.length > 1');
    await evaluate('document.querySelector("#publicProcedure").selectedIndex=1; document.querySelector("#publicProfessional").selectedIndex=1; document.querySelector("#choosePublicDate").click(); true');
    await waitFor('document.querySelectorAll("[data-public-date]:not(:disabled)").length > 0');
    await screenshot('mobile-booking');
    await setCookie(patientCookie);
    await navigate('/portal.html');
    await waitFor('document.querySelector("#portalServices button") && document.querySelector("#profileCompletionNote").hidden === false');
    await evaluate('document.querySelector("[data-portal-go=\\"agendar\\"]").click(); true');
    assert(await evaluate('!document.querySelector("#portal-perfil").hidden && document.activeElement.id === "profileName"'));
    await screenshot('mobile-patient-profile');
    for (const width of [360, 390, 768, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await setCookie(cookie);
      await navigate('/interno.html');
      await waitFor('!!document.querySelector("#overviewStats article")');
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Painel interno com rolagem horizontal em ' + width);
      await setCookie(patientCookie);
      await navigate('/portal.html');
      await waitFor('!!document.querySelector("#portalServices button")');
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Portal com rolagem horizontal em ' + width);
      checks += 2;
    }
    await screenshot('desktop-patient-portal');
    await setCookie(cookie);
    await navigate('/interno.html');
    await waitFor('!!document.querySelector("#overviewStats article")');
    await evaluate('document.querySelector("[data-tab=\\"pacientes\\"]").click(); true');
    await waitFor('Array.from(document.querySelectorAll("#patientsTable tr")).some(row => row.textContent.includes("Primeiro Atendimento"))');
    await evaluate('Array.from(document.querySelectorAll("#patientsTable tr")).find(row => row.textContent.includes("Primeiro Atendimento")).querySelector("[data-view-patient]").click(); true');
    await waitFor('!!document.querySelector("[data-create-portal-invite]")');
    await evaluate('document.querySelector("[data-create-portal-invite]").click(); true');
    await waitFor('!!document.querySelector("#portalInviteLink")');
    const invitationUrl = await evaluate('document.querySelector("#portalInviteLink").value');
    assert.equal(new URL(invitationUrl).searchParams.get('convite').length, 43);
    assert(await evaluate('document.activeElement.id === "portalInviteLink"'));
    await send('Network.clearBrowserCookies');
    await navigate('/cadastro.html');
    await evaluate('document.querySelector("#registerCpf").value="98765432100"; document.querySelector("#registerEmail").value="browser@example.invalid"; document.querySelector("#registerPassword").value="senha-interface-123"; document.querySelector("#registerAgeGroup").value="ADULTO"; document.querySelector("#registerAgeGroup").dispatchEvent(new Event("change")); document.querySelector("#privacyNoticeAccepted").checked=true; true');
    assert.equal(await evaluate('document.querySelector("#patientRegister").checkValidity()'), false);
    await evaluate('document.querySelector("#termsAccepted").checked=true; document.querySelector("#patientRegister").requestSubmit(); true');
    await waitFor('location.pathname === "/portal.html" && !!document.querySelector("#portalServices button")');
    await evaluate('document.querySelector("[data-portal-tab=\\"perfil\\"]").click(); document.querySelector("#profileName").value="Paciente Interface"; document.querySelector("#profileBirth").value="1990-01-01"; document.querySelector("#profileForm").requestSubmit(); true');
    await waitFor('document.querySelector("#profileMessage").textContent === "Dados atualizados."');
    await evaluate('document.querySelector("[data-portal-tab=\\"agendar\\"]").click(); true');
    assert.equal(await evaluate('document.querySelector("#portal-agendar").hidden'), false);
    await require('./verify-help-theme.cjs')({ send, evaluate, waitFor, navigate, screenshot, setCookie, cookie, patientCookie });
    await require('./verify-module-views.cjs')({ send, evaluate, waitFor, navigate, screenshot, setCookie, cookie });
    assert.deepEqual(errors, [], 'Erros JavaScript no navegador');
    console.log('OK: Chrome, ' + checks + ' combinações de página/largura; cookies, contraste, teclado, skeleton, cadastro, perfil, autorização dos pais e convite. Capturas: artifacts/verification/.');
  } finally {
    socket?.close();
    chrome.kill();
    // A fresh, task-specific temporary browser profile is the only deletion target.
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('sgcp-browser-')) {
      for (let i = 0; i < 20; i++) { try { fs.rmSync(resolved, { recursive: true, force: true }); break; } catch { await delay(200); } }
    }
  }
};
