const assert = require('node:assert/strict');

module.exports = async function verifyModuleViews({ send, evaluate, waitFor, navigate, screenshot, setCookie, cookie }) {
  await setCookie(cookie);
  await navigate('/interno.html');
  await waitFor('!!document.querySelector("#overviewStats article") && !!document.querySelector("#newPatientButton")');
  if (await evaluate('!document.querySelector(".cookie-banner").hidden')) await evaluate('document.querySelector("[data-cookie-choice=rejected]").click(); true');
  const go = async tab => {
    await evaluate('document.querySelector("#internalNav [data-tab=' + tab + ']").click(); true');
    await waitFor('!document.querySelector("#internal-' + tab + '").hidden');
  };
  const setQuery = async value => evaluate('document.querySelector("#patientSearch").value=' + JSON.stringify(value) + '; document.querySelector("#patientSearch").dispatchEvent(new Event("input")); true');
  const key = async (value, code = value) => {
    const keyCode = { Escape: 27, ArrowLeft: 37, ArrowRight: 39 }[value];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: keyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: keyCode });
  };
  const protectedStyles = () => evaluate(`JSON.stringify(['#internalSidebar','.internal-topbar','.internal-page-heading', '#internal-dashboard .content-card','#internal-dashboard .metric-card','#agendaCalendarGrid','.agenda-calendar-card','#internal-agenda input'].flatMap(selector=>[...document.querySelectorAll(selector)].map(el=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return [selector,s.backgroundColor,s.color,s.fontSize,s.padding,s.borderRadius,s.display,Math.round(r.width),Math.round(r.height)]})))`);
  for (const tab of ['dashboard', 'agenda']) {
    await go(tab);
    await waitFor(tab === 'agenda' ? '!!document.querySelector("#agendaCalendarGrid .calendar-day")' : '!!document.querySelector("#overviewStats article")');
    assert.equal(await evaluate('document.querySelector(".internal-page-heading").hasAttribute("data-module-heading")'), false);
    const enabled = await protectedStyles();
    await evaluate('document.querySelector("link[href=\\"/module-views.css\\"]").disabled=true; true');
    const disabled = await protectedStyles();
    assert.equal(enabled, disabled, 'A nova folha alterou o visual protegido: ' + tab);
    await evaluate('document.querySelector("link[href=\\"/module-views.css\\"]").disabled=false; true');
  }
  await go('pacientes');
  await waitFor('!!document.querySelector("#patientsTable tr")');
  await evaluate('document.querySelector("#newPatientButton").click(); true');
  assert(await evaluate('document.querySelector("#patientEditorDialog").open && document.activeElement.id === "patientName"'));
  await evaluate('document.querySelector("#patientBirth").value="2020-01-01";document.querySelector("#patientBirth").dispatchEvent(new Event("change")); true');
  assert(await evaluate('!document.querySelector("#staffGuardianFields").hidden && document.querySelector("#staffGuardianConsent").required'));
  await key('Escape');
  await waitFor('!document.querySelector("#patientEditorDialog").open');
  await waitFor('document.activeElement.id === "newPatientButton"');
  await evaluate('document.querySelector("#newPatientButton").click(); true');
  const digits = '876543210'.split('').map(Number);
  for (let length = 9; length < 11; length++) { const sum = digits.reduce((total, n, i) => total + n * (length + 1 - i), 0); digits.push((sum * 10) % 11 % 10); }
  const cpf = digits.join('');
  await evaluate('document.querySelector("#patientName").value="José Visual Teste"; document.querySelector("#patientCpf").value=' + JSON.stringify(cpf) + '; document.querySelector("#patientBirth").value="1990-01-01"; document.querySelector("#patientBirth").dispatchEvent(new Event("change")); document.querySelector("#patientForm").requestSubmit(); true');
  await waitFor('!document.querySelector("#patientEditorDialog").open && document.querySelector("#patientsTable").textContent.includes("José Visual Teste")');
  await setQuery('JOSE VISUAL');
  assert.equal(await evaluate('document.querySelectorAll("#patientsTable tbody tr").length'), 1);
  await evaluate('document.querySelector("[data-patient-filter=sem-contato]").click(); true');
  assert.equal(await evaluate('document.querySelectorAll("#patientsTable tbody tr").length'), 1);
  await evaluate('document.querySelector("[data-patient-filter=todos]").click(); true');
  await evaluate('document.querySelector("#patientsTable [data-edit-patient]").click(); true');
  await waitFor('document.querySelector("#patientEditorDialog").open');
  assert.equal(await evaluate('document.querySelector("#patientName").value'), 'José Visual Teste');
  await evaluate('document.querySelector("#patientPhone").value="11911112222"; document.querySelector("#patientForm").requestSubmit(); true');
  await waitFor('!document.querySelector("#patientEditorDialog").open && document.querySelector("#patientsTable").textContent.includes("11911112222")');
  await evaluate('document.querySelector("[data-patient-filter=menores]").click(); true');
  assert(await evaluate('!!document.querySelector("[data-reset-patient-filters]")'));
  await evaluate('document.querySelector("[data-reset-patient-filters]").click(); true');
  assert.equal(await evaluate('document.querySelector("#patientSearch").value'), '');
  assert.equal(await evaluate('document.querySelector("[data-patient-filter=todos]").getAttribute("aria-pressed")'), 'true');
  await go('financeiro');
  await evaluate('document.querySelector("[data-finance-tab=receitas]").focus(); true');
  await key('ArrowRight');
  assert.equal(await evaluate('document.querySelector("[data-finance-tab=despesas]").getAttribute("aria-selected")'), 'true');
  await evaluate('document.querySelector("#expenseDescription").value="Rascunho preservado"; true');
  await key('ArrowLeft');
  await key('ArrowRight');
  assert.equal(await evaluate('document.querySelector("#expenseDescription").value'), 'Rascunho preservado');
  await go('servicos');
  await waitFor('document.querySelectorAll("#catalogProcedureList .catalog-row").length > 0');
  assert(await evaluate('document.querySelector("#catalogSearch").closest(".content-card") !== document.querySelector("#catalogProcedureForm").closest(".content-card")'));
  await evaluate('document.querySelector("#catalogSearch").value="zzzzsemprocedimento";document.querySelector("#catalogSearch").dispatchEvent(new Event("input")); true');
  assert.equal(await evaluate('document.querySelector("#catalogSearchEmpty").hidden'), false);
  await evaluate('document.querySelector("#catalogSearch").value="";document.querySelector("#catalogSearch").dispatchEvent(new Event("input")); true');
  await waitFor('!document.querySelector("#toast").classList.contains("show")');
  let layouts = 0;
  const ready = {
    pacientes: '#patientsTable > *', atendimento: '#treatmentHistory > *', financeiro: '#revenueList > *',
    estoque: '#stockProducts > *', relatorios: '#financialReport > *', usuarios: '#usersList > *', servicos: '#catalogProcedureList > *', logs: '#systemLogList > *',
  };
  for (const theme of ['light', 'dark']) {
    if (await evaluate('document.documentElement.dataset.theme') !== theme) await evaluate('document.querySelector("[data-theme-toggle]").click(); true');
    for (const width of [360, 768, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
      for (const tab of Object.keys(ready)) {
        await go(tab);
        await waitFor('!!document.querySelector(' + JSON.stringify(ready[tab]) + ')');
        const size = await evaluate('({viewport:innerWidth, content:document.documentElement.scrollWidth})');
        assert(size.content <= size.viewport + 1, tab + '/' + width + '/' + theme + ': rolagem horizontal ' + JSON.stringify(size));
        assert.equal(await evaluate('document.querySelector(".internal-page-heading").dataset.moduleHeading'), tab);
        if (tab === 'servicos' && width === 1440) assert.equal(await evaluate('getComputedStyle(document.querySelector(".catalog-editor-grid")).gridTemplateColumns.split(" ").length'), 2);
        if (width === 1440 || (width === 360 && ['pacientes', 'servicos', 'financeiro'].includes(tab))) await screenshot('module-' + tab + '-' + theme + '-' + width);
        layouts++;
      }
    }
  }
  await go('pacientes');
  await evaluate('document.querySelector("#newPatientButton").click(); true');
  await screenshot('module-patient-editor-dark');
  await key('Escape');
  console.log('OK: módulos, cadastro/edição de paciente, busca sem acentos, filtros, formulário acessível, catálogo pesquisável, abas por teclado e ' + layouts + ' layouts. Barra lateral, Dashboard e Agenda preservados.');
};
