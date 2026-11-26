import { adminIcon } from './admin-icons.js';

const modules = {
  pacientes: ['patients', 'Cadastros e histórico em um só lugar', 'Encontre um paciente, consulte sua ficha ou atualize os dados de contato.', 'guia-pacientes-equipe'],
  atendimento: ['treatment', 'Informação organizada para o cuidado', 'Preencha a ficha de saúde e registre a evolução do atendimento.', 'guia-atendimento-equipe'],
  financeiro: ['wallet', 'Cuide dos lançamentos da clínica', 'Separe o que entrou, o que está a receber e as próximas contas a pagar.', 'guia-gestao-equipe'],
  estoque: ['stock', 'Materiais sempre à mão', 'Mantenha os saldos atualizados e acompanhe as entradas e saídas.', 'guia-gestao-equipe'],
  relatorios: ['reports', 'Uma visão clara dos resultados', 'Escolha o período para consultar os indicadores e preparar a impressão.', 'guia-gestao-equipe'],
  usuarios: ['users', 'Cada pessoa com o acesso certo', 'Organize as contas da equipe e as permissões de cada perfil.', 'guia-gestao-equipe'],
  servicos: ['services', 'Um catálogo fácil de manter', 'Atualize os procedimentos, valores e a disponibilidade no site.', 'guia-agenda-equipe'],
  logs: ['logs', 'Acompanhe as atividades do sistema', 'Localize ações por usuário, operação ou rota para conferir o histórico.', 'guia-gestao-equipe'],
};

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
const minor = birth => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || '')) return false;
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return Number(now.slice(0, 4)) - Number(birth.slice(0, 4)) - (now.slice(5) < birth.slice(5) ? 1 : 0) < 18;
};

export function initModuleViews({ getPatients, getProducts, onPatientFilter, onNewPatient }) {
  const $ = id => document.getElementById(id);
  let patientFilter = 'todos';
  let returnFocus;
  const patientPanel = $('internal-pacientes');
  const card = $('patientForm').closest('.content-card');
  const directory = $('patientsTable').closest('.content-card');
  directory.classList.add('patient-directory');
  const editor = document.createElement('dialog');
  editor.id = 'patientEditorDialog';
  editor.className = 'module-editor';
  editor.setAttribute('aria-labelledby', 'patientFormTitle');
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'module-editor-close icon-button'; close.setAttribute('aria-label', 'Fechar cadastro do paciente'); close.textContent = '×';
  editor.append(close, card);
  patientPanel.append(editor);
  patientPanel.querySelector('.two-column').classList.add('patient-directory-layout');
  close.addEventListener('click', () => editor.close());
  editor.addEventListener('click', event => {
    const bounds = editor.getBoundingClientRect();
    if (event.target === editor && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) editor.close();
  });
  editor.addEventListener('close', () => {
    const target = returnFocus?.isConnected ? returnFocus : $('newPatientButton');
    if (!patientPanel.hidden) target?.focus({ preventScroll: true });
  });

  for (const [name, [icon, title, description, guide]] of Object.entries(modules)) {
    const panel = $('internal-' + name);
    panel.classList.add('module-panel');
    const toolbar = document.createElement('div');
    toolbar.className = 'module-toolbar';
    toolbar.innerHTML = '<span class="module-toolbar-icon" aria-hidden="true">' + adminIcon(icon) + '</span><div class="module-toolbar-copy"><strong>' + title + '</strong><p>' + description + '</p></div><div class="module-toolbar-actions"><a class="module-guide" href="/ajuda.html?publico=equipe#' + guide + '">Guia de uso <span aria-hidden="true">↗</span></a></div>';
    panel.prepend(toolbar);
    for (const heading of panel.querySelectorAll('.content-card > .card-heading:not(.sub-heading)')) {
      const badge = document.createElement('span'); badge.className = 'module-card-icon'; badge.setAttribute('aria-hidden', 'true'); badge.innerHTML = adminIcon(icon); heading.prepend(badge);
    }
    const observer = new MutationObserver(() => { decorateTables(panel); updateStock(); });
    observer.observe(panel, { childList: true, subtree: true });
    decorateTables(panel);
  }
  const newPatient = document.createElement('button');
  newPatient.id = 'newPatientButton'; newPatient.type = 'button'; newPatient.className = 'button button-primary';
  newPatient.innerHTML = adminIcon('plus') + 'Novo paciente';
  newPatient.addEventListener('click', () => { onNewPatient(); openPatientEditor(newPatient); });
  patientPanel.querySelector('.module-toolbar-actions').append(newPatient);
  const summary = document.createElement('div'); summary.className = 'patient-summary';
  summary.innerHTML = '<span><strong id="patientTotalCount">0</strong> na listagem</span><span><strong id="patientMinorCount">0</strong> menores de 18 anos</span><span><strong id="patientContactCount">0</strong> sem contato informado</span>';
  directory.querySelector('.card-heading').after(summary);
  const filterBar = document.createElement('div'); filterBar.className = 'patient-filter-bar';
  filterBar.innerHTML = '<div class="module-filter-group" role="group" aria-label="Filtrar pacientes"><button type="button" data-patient-filter="todos" aria-pressed="true">Todos</button><button type="button" data-patient-filter="menores" aria-pressed="false">Menores de idade</button><button type="button" data-patient-filter="sem-contato" aria-pressed="false">Sem contato</button></div><span id="patientResultCount" class="module-result-count" role="status" aria-live="polite"></span>';
  const search = $('patientSearch');
  search.type = 'search'; search.maxLength = 160; search.setAttribute('aria-label', 'Buscar pacientes por nome ou CPF');
  search.closest('label').classList.add('module-search');
  search.previousElementSibling.innerHTML = adminIcon('search');
  search.closest('label').after(filterBar);
  filterBar.addEventListener('click', event => {
    const button = event.target.closest('[data-patient-filter]');
    if (!button) return;
    patientFilter = button.dataset.patientFilter;
    filterBar.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    onPatientFilter();
  });
  $('patientsTable').addEventListener('click', event => {
    if (event.target.closest('[data-reset-patient-filters]')) {
      search.value = ''; patientFilter = 'todos';
      filterBar.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.patientFilter === 'todos')));
      onPatientFilter(); search.focus();
    }
    if (event.target.closest('[data-new-patient-empty]')) { onNewPatient(); openPatientEditor(event.target.closest('[data-new-patient-empty]')); }
  });

  // Give the catalog its own list, instead of mixing it into the editing form.
  const catalogGrid = $('internal-servicos').querySelector('.catalog-editor-grid');
  const catalogCard = document.createElement('div'); catalogCard.className = 'content-card module-catalog-directory';
  catalogCard.innerHTML = '<div class="card-heading"><span class="module-card-icon" aria-hidden="true">' + adminIcon('services') + '</span><div><p class="eyebrow">Catálogo da clínica</p><h2>Procedimentos cadastrados</h2></div></div><label class="module-search"><span aria-hidden="true">' + adminIcon('search') + '</span><input id="catalogSearch" type="search" maxlength="160" placeholder="Buscar procedimento" aria-label="Buscar procedimento no catálogo"></label><p class="module-result-count" id="catalogResultCount" role="status" aria-live="polite"></p>';
  catalogCard.append($('catalogProcedureList')); catalogGrid.append(catalogCard);
  const newProcedure = document.createElement('button'); newProcedure.type = 'button'; newProcedure.id = 'newProcedureButton'; newProcedure.className = 'button button-primary'; newProcedure.innerHTML = adminIcon('plus') + 'Novo procedimento';
  newProcedure.addEventListener('click', () => { $('clearCatalogProcedure').click(); $('catalogProcedureForm').scrollIntoView({ block: 'start' }); $('catalogProcedureName').focus({ preventScroll: true }); });
  $('internal-servicos').querySelector('.module-toolbar-actions').append(newProcedure);
  const filterCatalog = () => {
    const query = normalize($('catalogSearch').value);
    let count = 0;
    $('catalogProcedureList').querySelectorAll('.catalog-row').forEach(row => { row.hidden = !normalize(row.textContent).includes(query); if (!row.hidden) count++; });
    const label = count + (count === 1 ? ' procedimento encontrado' : ' procedimentos encontrados');
    if ($('catalogResultCount').textContent !== label) $('catalogResultCount').textContent = label;
    let empty = $('catalogSearchEmpty');
    if (!empty) { empty = document.createElement('p'); empty.id = 'catalogSearchEmpty'; empty.className = 'empty'; empty.textContent = 'Nenhum procedimento corresponde à busca. Tente outro nome.'; catalogCard.append(empty); }
    empty.hidden = !query || count > 0;
  };
  $('catalogSearch').addEventListener('input', filterCatalog);
  new MutationObserver(filterCatalog).observe($('catalogProcedureList'), { childList: true, subtree: true });
  $('internal-servicos').querySelector(':scope > .content-card').classList.add('module-catalog-note');
  const stockInfo = document.createElement('span'); stockInfo.id = 'moduleStockInfo'; stockInfo.className = 'module-stock-info';
  $('internal-estoque').querySelector('.module-toolbar-actions').prepend(stockInfo);
  // Native tabs keep their existing behavior and gain arrow-key navigation.
  document.querySelectorAll('.module-panel .subnav[role="tablist"]').forEach(tablist => {
    tablist.setAttribute('aria-label', tablist.closest('#internal-financeiro') ? 'Visão do financeiro' : 'Tipo de relatório');
    tablist.addEventListener('keydown', event => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')].filter(tab => !tab.hidden && !tab.disabled);
      const index = tabs.indexOf(document.activeElement);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
  });
  function updateStock() {
    const products = getProducts();
    const low = products.filter(product => Number(product.quantidade_atual) <= Number(product.estoque_minimo)).length;
    const value = products.length ? (low ? low + (low === 1 ? ' item para repor' : ' itens para repor') : 'Estoque em dia') : 'Nenhum material cadastrado';
    if ($('moduleStockInfo') && $('moduleStockInfo').textContent !== value) $('moduleStockInfo').textContent = value;
  }
  function decorateTables(panel) {
    panel.querySelectorAll('table').forEach(table => {
      table.classList.add('module-table');
      const headings = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell, index) => { cell.dataset.label = headings[index] || 'Ações'; }));
    });
  }
  function openPatientEditor(trigger = document.activeElement) {
    returnFocus = trigger;
    if (!editor.open) editor.showModal();
    $('patientName').focus({ preventScroll: true });
  }
  return {
    openPatientEditor,
    closePatientEditor() { if (editor.open) editor.close(); },
    onNavigate(tab) {
      const heading = document.querySelector('.internal-page-heading');
      if (modules[tab]) heading.dataset.moduleHeading = tab;
      else heading.removeAttribute('data-module-heading');
      if (tab !== 'pacientes' && editor.open) editor.close();
    },
    filterPatients(patients, value) {
      const query = normalize(value); const digits = query.replace(/\D/g, '');
      return patients.filter(patient => (!query || normalize(patient.nome).includes(query) || (digits && String(patient.cpf || '').includes(digits))) &&
        (patientFilter === 'todos' || (patientFilter === 'menores' && minor(patient.data_nascimento)) || (patientFilter === 'sem-contato' && !patient.telefone && !patient.email)));
    },
    updatePatientSummary(count) {
      const patients = getPatients();
      $('patientTotalCount').textContent = patients.length;
      $('patientMinorCount').textContent = patients.filter(patient => minor(patient.data_nascimento)).length;
      $('patientContactCount').textContent = patients.filter(patient => !patient.telefone && !patient.email).length;
      $('patientResultCount').textContent = count + (count === 1 ? ' paciente encontrado' : ' pacientes encontrados');
    },
  };
}
