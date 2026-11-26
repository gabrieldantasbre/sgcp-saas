import {
  api, escapeHtml, money, dateISO, formatDate, formatLongDate, formatTime,
  initials, optionList, formatCpf, cpfDigits, setMessage, statusBadge, toast,
} from './common.js';
import { adminIcon } from './admin-icons.js';
import { showSkeleton } from './common.js';
import { initAdminMobile } from './admin-mobile.js';
import { initAgendaUI } from './agenda-ui.js';
import { initModuleViews } from './module-views.js';

const $ = (id) => document.getElementById(id);
const titulos = {
  dashboard: ['Dashboard', 'Acompanhe a rotina e os indicadores da sua clínica.'],
  agenda: ['Agenda', 'Consultas de hoje e próximos agendamentos'],
  pacientes: ['Pacientes', 'Cadastro e consulta de pacientes'],
  atendimento: ['Atendimento', 'Anamnese, histórico e registro clínico'],
  financeiro: ['Financeiro', 'Receitas, despesas e contas a pagar'],
  estoque: ['Estoque', 'Materiais e movimentações da clínica'],
  relatorios: ['Relatórios', 'Informações para gestão da clínica'],
  usuarios: ['Usuários', 'Contas e permissões do sistema'],
};

titulos.servicos = ['Serviços', 'Procedimentos disponíveis na clínica'];
titulos.logs = ['Logs do sistema', 'Registro de ações e alterações'];

export async function initInternal() {
  let session;
  try { session = await api('/api/auth/me'); }
  catch { window.location.replace('/login.html'); return; }
  if (session.usuario.perfil === 'PACIENTE') {
    window.location.replace('/portal.html');
    return;
  }

  const profile = session.usuario.perfil;
  const isOwner = profile === 'PODOLOGA';
  const permissions = new Set(session.usuario.permissoes || []);
  const hasPermission = (permission) => isOwner || permissions.has(permission);
  const hasAnyPermission = (list) => list.some(hasPermission);
  const state = { user: session.usuario, patients: [], procedures: [], products: [], appointments: [], calendarAppointments: [], calendarBlocks: [], calendarHolidays: [], catalogProcedures: [], systemLogs: [], editProductId: null };

  document.querySelectorAll('[data-permission]').forEach((element) => {
    element.hidden = !hasPermission(element.dataset.permission);
  });
  document.querySelectorAll('[data-permission-any]').forEach((element) => {
    element.hidden = !hasAnyPermission(element.dataset.permissionAny.split(','));
  });
  document.querySelectorAll('[data-owner-only]').forEach((element) => { element.hidden = !isOwner; });
  $('internalUserName').textContent = session.usuario.nome;
  $('userInitials').textContent = initials(session.usuario.nome);
  $('topbarUserName').textContent = session.usuario.nome;
  $('topbarInitials').textContent = initials(session.usuario.nome);
  const navIcons = { dashboard: 'dashboard', agenda: 'calendar', pacientes: 'patients', atendimento: 'treatment', financeiro: 'wallet', estoque: 'stock', relatorios: 'reports', usuarios: 'users', servicos: 'services', logs: 'logs' };
  document.querySelectorAll('#internalNav [data-tab]').forEach((button) => { button.querySelector('span').innerHTML = adminIcon(navIcons[button.dataset.tab]); });
  document.querySelectorAll('[data-admin-icon]').forEach((element) => { element.innerHTML = adminIcon(element.dataset.adminIcon); });
  document.querySelector('.global-search-field > span').innerHTML = adminIcon('search');
  $('logoutButton').innerHTML = adminIcon('logout');
  $('internalUserRole').textContent = session.usuario.perfilNome || (isOwner ? 'Podóloga proprietária' : 'Equipe');
  $('internalDate').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const mobileNavigation = initAdminMobile();
  const agendaUI = initAgendaUI({ hasPermission, onStatus: updateAppointmentStatus, onCare: startAppointmentCare });

  async function safe(url, fallback = []) {
    try { return await api(url); } catch (error) { toast(error.message); return fallback; }
  }

  async function loadPatients() {
    const [allPatients, bookingPatients, carePatients, revenuePatients] = await Promise.all([
      hasPermission('pacientes') ? safe('/api/pacientes') : Promise.resolve([]),
      hasPermission('agenda') && !hasPermission('pacientes') ? safe('/api/pacientes/opcoes?uso=agenda') : Promise.resolve(null),
      hasPermission('atendimento') && !hasPermission('pacientes') ? safe('/api/pacientes/opcoes?uso=atendimento') : Promise.resolve(null),
      hasPermission('receitas') && !hasPermission('pacientes') ? safe('/api/pacientes/opcoes?uso=receitas') : Promise.resolve(null),
    ]);
    state.patients = allPatients;
    const selectOptions = {
      bookingPatient: bookingPatients || allPatients,
      anamnesisPatient: carePatients || allPatients,
      carePatient: carePatients || allPatients,
      revenuePatient: revenuePatients || allPatients,
    };
    Object.entries(selectOptions).forEach(([id, patients]) => {
      const select = $(id);
      if (!select) return;
      const requiredPermission = id === 'bookingPatient' ? 'agenda' :
        ['anamnesisPatient', 'carePatient'].includes(id) ? 'atendimento' : 'receitas';
      if (!hasPermission(requiredPermission)) return;
      const previous = select.value;
      const placeholder = id === 'revenuePatient' ? 'Sem paciente relacionado' : 'Selecione um paciente';
      select.innerHTML = optionList(patients, placeholder, (p) => p.id, (p) => p.nome);
      if (previous) select.value = previous;
    });
    if (hasPermission('pacientes')) renderPatients($('patientSearch').value);
  }

  async function loadProcedures() {
    state.procedures = await safe('/api/procedimentos');
    ['bookingProcedure', 'careProcedure'].forEach((id) => {
      const select = $(id);
      if (!select) return;
      const previous = select.value;
      select.innerHTML = optionList(state.procedures, 'Selecione um serviço', (p) => p.id,
        (p) => p.nome + ' · ' + (Number(p.valor_referencia) === 0 ? 'gratuito' : money(p.valor_referencia)));
      if (previous) select.value = previous;
    });
  }

  async function loadProducts() {
    state.products = await safe('/api/estoque/produtos');
    const options = optionList(state.products, 'Selecione um produto',
      (p) => p.id, (p) => p.nome + ' (' + p.quantidade_atual + ' ' + p.unidade_medida + ')');
    $('movementProduct').innerHTML = options;
    renderProducts();
  }

  function renderCatalogLists() {
    $('catalogProcedureList').innerHTML = state.catalogProcedures.length ? state.catalogProcedures.map((item) =>
      '<article class="catalog-row"><div><strong>' + escapeHtml(item.nome) + '</strong><small>' + escapeHtml(item.descricao || 'Sem descrição') +
      '</small><span>' + money(item.preco) + ' · ' + escapeHtml(item.duracao) + ' min · ' + (item.ativo ? 'Ativo' : 'Inativo') + '</span></div><div class="catalog-row-actions">' +
      '<button class="button button-outline button-small" type="button" data-edit-catalog-procedure="' + escapeHtml(item.id) + '">Editar</button>' +
      '<button class="button button-outline button-small" type="button" data-toggle-catalog-procedure="' + escapeHtml(item.id) + '" data-active="' + (!item.ativo) + '">' + (item.ativo ? 'Desativar' : 'Ativar') + '</button></div></article>'
    ).join('') : '<p class="empty">Nenhum procedimento cadastrado.</p>';
  }

  async function loadCatalog() {
    if (!isOwner) return;
    try {
      const catalog = await api('/api/catalogo/admin');
      state.catalogProcedures = catalog.procedimentos;
      renderCatalogLists();
    } catch (error) {
      $('catalogProcedureList').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>';
    }
  }

  function renderSystemLogs(query = '') {
    const termo = String(query).trim().toLocaleLowerCase('pt-BR');
    const rows = state.systemLogs.filter((item) => !termo ||
      [item.usuario_nome, item.acao, item.rota].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(termo)));
    $('systemLogList').innerHTML = rows.length ? '<table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Resultado</th></tr></thead><tbody>' +
      rows.map((item) => '<tr><td>' + escapeHtml(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(item.criado_em))) +
        '</td><td>' + escapeHtml(item.usuario_nome) + '</td><td><strong>' + escapeHtml(item.acao) + '</strong><small class="table-subtitle">' + escapeHtml(item.rota) +
        '</small></td><td><span class="log-status">HTTP ' + escapeHtml(item.status_http) + '</span></td></tr>').join('') +
      '</tbody></table>' : '<p class="empty">Nenhum log corresponde ao filtro.</p>';
  }

  async function loadSystemLogs() {
    if (!isOwner) return;
    try {
      state.systemLogs = await api('/api/logs');
      renderSystemLogs($('systemLogSearch').value);
    } catch (error) {
      $('systemLogList').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>';
    }
  }

  function clearCatalogProcedureForm() {
    $('catalogProcedureForm').reset();
    $('catalogProcedureId').value = '';
    $('catalogProcedureTitle').textContent = 'Novo procedimento';
    $('catalogProcedureForm').querySelector('button[type="submit"]').textContent = 'Salvar procedimento';
    setMessage($('catalogProcedureMessage'), '');
  }
  $('clearCatalogProcedure').addEventListener('click', clearCatalogProcedureForm);
  $('catalogProcedureForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('catalogProcedureId').value;
    try {
      await api(id ? '/api/catalogo/procedimentos/' + encodeURIComponent(id) : '/api/catalogo/procedimentos', {
        method: id ? 'PUT' : 'POST',
        body: {
          nome: $('catalogProcedureName').value.trim(),
          descricao: $('catalogProcedureDescription').value.trim(),
          valorReferencia: Number($('catalogProcedurePrice').value),
          duracaoMin: Number($('catalogProcedureDuration').value),
        },
      });
      clearCatalogProcedureForm();
      await loadCatalog();
      toast(id ? 'Serviço atualizado.' : 'Serviço criado.', true);
    } catch (error) { setMessage($('catalogProcedureMessage'), error.message); }
  });
  $('catalogProcedureList').addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-catalog-procedure]');
    if (edit) {
      const item = state.catalogProcedures.find((row) => row.id === edit.dataset.editCatalogProcedure);
      if (!item) return;
      $('catalogProcedureId').value = item.id;
      $('catalogProcedureName').value = item.nome;
      $('catalogProcedureDescription').value = item.descricao || '';
      $('catalogProcedurePrice').value = item.preco;
      $('catalogProcedureDuration').value = item.duracao;
      $('catalogProcedureTitle').textContent = 'Editar procedimento';
      $('catalogProcedureForm').querySelector('button[type="submit"]').textContent = 'Salvar alterações';
      $('catalogProcedureName').focus();
      return;
    }
    const toggle = event.target.closest('[data-toggle-catalog-procedure]');
    if (!toggle) return;
    try {
      await api('/api/catalogo/procedimentos/' + encodeURIComponent(toggle.dataset.toggleCatalogProcedure) + '/ativo', {
        method: 'PATCH', body: { ativo: toggle.dataset.active === 'true' },
      });
      await loadCatalog();
      await loadProcedures();
      toast(toggle.dataset.active === 'true' ? 'Serviço ativado.' : 'Serviço removido do site e de novos agendamentos.', true);
    } catch (error) { toast(error.message); }
  });

  $('systemLogSearch').addEventListener('input', (event) => renderSystemLogs(event.currentTarget.value));

  async function loadAppointments(de = dateISO(), ate = dateISO(new Date(Date.now() + 30 * 86400000))) {
    if (!hasPermission('agenda')) return;
    try {
      state.appointments = await api('/api/agendamentos?de=' + encodeURIComponent(de) + '&ate=' + encodeURIComponent(ate));
      renderAppointments();
      fillCareAppointments();
      fillStockAttendance();
    } catch (error) {
      $('appointmentList').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>';
      state.appointments = [];
    }
  }

  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedCalendarDate = dateISO();
  let calendarView = 'month';

  function feriadosNacionaisNoPeriodo(de, ate) {
    const listarFeriados = (ano) => {
      const a = ano % 19;
      const b = Math.floor(ano / 100);
      const c = ano % 100;
      const d = Math.floor(b / 4);
      const e = b % 4;
      const f = Math.floor((b + 8) / 25);
      const g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30;
      const i = Math.floor(c / 4);
      const k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7;
      const m = Math.floor((a + 11 * h + 22 * l) / 451);
      const n = h + l - 7 * m + 114;
      const pascoa = new Date(Date.UTC(ano, Math.floor(n / 31) - 1, (n % 31) + 1));
      pascoa.setUTCDate(pascoa.getUTCDate() - 2);
      return [
        { data: ano + '-01-01', nome: 'Confraternização Universal' },
        { data: pascoa.toISOString().slice(0, 10), nome: 'Paixão de Cristo' },
        { data: ano + '-04-21', nome: 'Tiradentes' },
        { data: ano + '-05-01', nome: 'Dia Mundial do Trabalho' },
        { data: ano + '-09-07', nome: 'Independência do Brasil' },
        { data: ano + '-10-12', nome: 'Nossa Senhora Aparecida' },
        { data: ano + '-11-02', nome: 'Finados' },
        { data: ano + '-11-15', nome: 'Proclamação da República' },
        { data: ano + '-11-20', nome: 'Dia Nacional de Zumbi e da Consciência Negra' },
        { data: ano + '-12-25', nome: 'Natal' },
      ];
    };
    const feriados = [];
    for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano += 1) {
      feriados.push(...listarFeriados(ano));
    }
    return feriados.filter((feriado) => feriado.data >= de && feriado.data <= ate);
  }

  function renderCalendarDay() {
    const selected = state.calendarAppointments.filter((item) => item.data === selectedCalendarDate)
      .sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
    const holiday = state.calendarHolidays.find((item) => item.data === selectedCalendarDate);
    $('calendarSelectedDate').textContent = formatLongDate(selectedCalendarDate);
    $('calendarDayCount').textContent = selected.length ? selected.length + (selected.length === 1 ? ' consulta' : ' consultas') : '';
    $('calendarDayHoliday').hidden = !holiday;
    $('calendarDayHoliday').textContent = holiday ? 'Feriado nacional: ' + holiday.nome : '';
    $('calendarDayAppointments').innerHTML = selected.length
      ? appointmentTable(selected)
      : '<p class="empty">Nenhuma consulta neste dia.</p>';
    const blocks = state.calendarBlocks.filter((item) => item.data === selectedCalendarDate);
    $('calendarDayAppointments').innerHTML += blocks.map((item) => '<p class="agenda-block-note">Bloqueado: ' + escapeHtml(item.inicio) + '–' + escapeHtml(item.fim) + ' · ' + escapeHtml(item.motivo || 'Indisponível') + '</p>').join('');
    $('agendaBlockList').innerHTML = state.calendarBlocks.length ? '<h3>Bloqueios do período exibido</h3>' + state.calendarBlocks.map((item) => '<div class="agenda-block-row"><span><strong>' + escapeHtml(formatDate(item.data)) + ' · ' + escapeHtml(item.inicio) + '–' + escapeHtml(item.fim) + '</strong><small>' + escapeHtml(item.motivo || 'Indisponível') + '</small></span><button class="button button-outline button-small" type="button" data-remove-block="' + escapeHtml(item.id) + '">Liberar</button></div>').join('') : '<p class="small-note">Nenhum bloqueio no período exibido.</p>';
  }

  function renderCalendar() {
    const anchor = new Date(selectedCalendarDate + 'T12:00:00');
    const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(calendarMonth);
    const weekStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    const label = calendarView === 'month' ? monthLabel.charAt(0).toLocaleUpperCase('pt-BR') + monthLabel.slice(1)
      : calendarView === 'day' ? formatLongDate(selectedCalendarDate)
        : formatDate(dateISO(weekStart)) + ' – ' + formatDate(dateISO(weekEnd));
    $('calendarMonthLabel').textContent = label;
    $('agendaCalendarGrid').hidden = calendarView === 'day';
    document.querySelector('.agenda-calendar-weekdays').hidden = calendarView === 'day';
    $('agendaCalendarGrid').classList.toggle('calendar-grid-day', calendarView === 'day');
    document.querySelectorAll('[data-calendar-view]').forEach((button) => {
      const active = button.dataset.calendarView === calendarView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const previousLabel = calendarView === 'day' ? 'Dia anterior' : calendarView === 'week' ? 'Semana anterior' : 'Mês anterior';
    const nextLabel = calendarView === 'day' ? 'Próximo dia' : calendarView === 'week' ? 'Próxima semana' : 'Próximo mês';
    $('calendarPrevious').setAttribute('aria-label', previousLabel);
    $('calendarNext').setAttribute('aria-label', nextLabel);
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthGridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const gridStart = calendarView === 'month' ? monthGridStart : calendarView === 'week' ? weekStart : anchor;
    const cellCount = calendarView === 'month' ? 42 : calendarView === 'week' ? 7 : 0;
    const hoje = dateISO();
    const eventsByDay = new Map();
    state.calendarAppointments.forEach((appointment) => {
      const events = eventsByDay.get(appointment.data) || [];
      events.push(appointment);
      eventsByDay.set(appointment.data, events);
    });
    const holidaysByDay = new Map(state.calendarHolidays.map((holiday) => [holiday.data, holiday]));
    const cells = Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const iso = dateISO(date);
      const appointments = (eventsByDay.get(iso) || []).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
      const holiday = holidaysByDay.get(iso);
      const currentMonth = calendarView !== 'month' || date.getMonth() === calendarMonth.getMonth();
      const classes = ['calendar-day'];
      if (!currentMonth) classes.push('calendar-day-outside');
      if (iso === hoje) classes.push('calendar-day-today');
      if (iso === selectedCalendarDate) classes.push('calendar-day-selected');
      const holidayEvent = holiday
        ? '<span class="calendar-event calendar-event-holiday" title="' + escapeHtml(holiday.nome) + '">Feriado nacional</span>'
        : '';
      const maxAppointments = holiday ? 2 : 3;
      const blockEvents = state.calendarBlocks.filter((item) => item.data === iso).map((item) => '<span class="calendar-event calendar-event-block">' + escapeHtml(item.inicio) + '–' + escapeHtml(item.fim) + ' Bloqueado</span>').join('');
      const events = holidayEvent + blockEvents + appointments.slice(0, maxAppointments).map((appointment) => {
        const status = String(appointment.status || '').toLowerCase();
        return '<button type="button" class="calendar-event calendar-event-' + escapeHtml(status) + '" data-appointment-detail="' + escapeHtml(appointment.id) + '" aria-label="' + escapeHtml('Ver consulta de ' + appointment.paciente_nome + ' às ' + formatTime(appointment.hora)) + '">' +
          '<time>' + escapeHtml(formatTime(appointment.hora)) + '</time> ' + escapeHtml(appointment.paciente_nome) + '</button>';
      }).join('');
      const more = appointments.length > maxAppointments ? '<span class="calendar-event-more">+' + (appointments.length - maxAppointments) + ' mais</span>' : '';
      return '<div role="gridcell" class="' + classes.join(' ') + '" data-calendar-date="' + iso + '" aria-selected="' + (iso === selectedCalendarDate) + '"><button type="button" class="calendar-day-select" aria-label="' +
        escapeHtml(formatLongDate(iso) + (holiday ? ', feriado nacional: ' + holiday.nome : '') + ', ' + appointments.length + (appointments.length === 1 ? ' consulta' : ' consultas')) + '">' +
        '<span class="calendar-day-number">' + date.getDate() + '</span></button><div class="calendar-events">' + events + more + '</div></div>';
    });
    $('agendaCalendarGrid').innerHTML = cells.join('');
    renderCalendarDay();
  }

  async function loadCalendar(month = calendarMonth) {
    if (!hasPermission('agenda')) return;
    const anchor = new Date(selectedCalendarDate + 'T12:00:00');
    calendarMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const firstOfMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthGridStart = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - firstOfMonth.getDay());
    const weekStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
    const gridStart = calendarView === 'month' ? monthGridStart : calendarView === 'week' ? weekStart : anchor;
    const span = calendarView === 'month' ? 41 : calendarView === 'week' ? 6 : 0;
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + span);
    const first = dateISO(gridStart);
    const last = dateISO(gridEnd);
    const stopDay = showSkeleton($('calendarDayAppointments'), 'Carregando consultas');
    const stopCalendar = showSkeleton($('agendaCalendarGrid'), 'Carregando calendário');
    try {
      [state.calendarAppointments, state.calendarBlocks] = await Promise.all([
        api('/api/agendamentos?de=' + first + '&ate=' + last),
        api('/api/agendamentos/bloqueios?de=' + first + '&ate=' + last),
      ]);
      state.calendarHolidays = feriadosNacionaisNoPeriodo(first, last);
      renderCalendar();
    } catch (error) {
      state.calendarAppointments = [];
      state.calendarBlocks = [];
      state.calendarHolidays = [];
      $('agendaCalendarGrid').innerHTML = '<p class="form-message error calendar-loading">' + escapeHtml(error.message) + '</p>';
      $('calendarDayAppointments').innerHTML = '<p class="empty">Não foi possível carregar as consultas.</p>';
    } finally { stopDay(); stopCalendar(); }
  }

  function shiftCalendar(direction) {
    const date = new Date(selectedCalendarDate + 'T12:00:00');
    if (calendarView === 'month') {
      date.setDate(1);
      date.setMonth(date.getMonth() + direction);
    } else {
      date.setDate(date.getDate() + direction * (calendarView === 'week' ? 7 : 1));
    }
    selectedCalendarDate = dateISO(date);
    loadCalendar();
  }
  $('calendarPrevious').addEventListener('click', () => shiftCalendar(-1));
  $('calendarNext').addEventListener('click', () => shiftCalendar(1));
  $('calendarToday').addEventListener('click', () => {
    selectedCalendarDate = dateISO();
    loadCalendar();
  });
  document.querySelectorAll('[data-calendar-view]').forEach((button) => {
    button.addEventListener('click', () => {
      calendarView = button.dataset.calendarView;
      loadCalendar();
    });
  });
  $('agendaCalendarGrid').addEventListener('click', (event) => {
    const appointment = event.target.closest('[data-appointment-detail]');
    if (appointment) { agendaUI.openAppointment(appointment.dataset.appointmentDetail); return; }
    const button = event.target.closest('[data-calendar-date]');
    if (!button) return;
    selectedCalendarDate = button.dataset.calendarDate;
    const date = new Date(selectedCalendarDate + 'T12:00:00');
    if (date.getMonth() !== calendarMonth.getMonth() || date.getFullYear() !== calendarMonth.getFullYear()) {
      calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      loadCalendar(calendarMonth);
    } else {
      renderCalendar();
    }
  });

  function goTo(tab) {
    const panel = $('internal-' + tab);
    const tabPermission = {
      dashboard: ['dashboard'], agenda: ['agenda'], pacientes: ['pacientes'], atendimento: ['atendimento'],
      financeiro: ['receitas', 'despesas'], estoque: ['estoque'], relatorios: ['relatorio_estoque', 'relatorio_financeiro'],
    };
    const allowed = ['usuarios', 'servicos', 'logs'].includes(tab) ? isOwner : hasAnyPermission(tabPermission[tab] || []);
    if (!panel || !titulos[tab] || !allowed) return;
    document.querySelectorAll('.internal-panel').forEach((item) => {
      const active = item === panel;
      item.hidden = !active;
      item.classList.toggle('active', active);
    });
    document.querySelectorAll('#internalNav [data-tab]').forEach((button) => {
      const active = button.dataset.tab === tab && !button.hidden;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('internalTitle').textContent = titulos[tab][0];
    $('internalSubtitle').textContent = titulos[tab][1];
    moduleViews.onNavigate(tab);
    mobileNavigation.onNavigate(tab);
    $('internalEyebrow').textContent = ['usuarios', 'servicos', 'logs'].includes(tab) ? 'Administração' : ['financeiro', 'estoque', 'relatorios'].includes(tab) ? 'Gestão' : 'Visão geral';
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'agenda') {
      loadAppointments($('agendaDateFrom').value, $('agendaDateTo').value);
      loadCalendar(calendarMonth);
    }
    if (tab === 'pacientes') loadPatients();
    if (tab === 'atendimento' && hasPermission('atendimento')) {
      loadTreatmentHistory();
      loadAnamnesisHistory($('anamnesisPatient').value);
    }
    if (tab === 'financeiro') {
      setSubtab('finance', hasPermission('receitas') ? 'receitas' : 'despesas');
      if (hasPermission('receitas')) loadRevenues();
      if (hasPermission('despesas')) loadExpenses();
    }
    if (tab === 'estoque') { loadProducts(); loadMovements(); }
    if (tab === 'relatorios') {
      setSubtab('report', hasPermission('relatorio_financeiro') ? 'financeiro' : 'estoque');
      if (hasPermission('relatorio_financeiro')) loadFinancialReport();
      if (hasPermission('relatorio_estoque')) loadStockReport();
    }
    if (tab === 'usuarios' && isOwner) {
      loadUsers();
      loadProfiles();
    }
    if (tab === 'servicos' && isOwner) loadCatalog();
    if (tab === 'logs' && isOwner) loadSystemLogs();
  }

  function setSubtab(group, name) {
    const config = group === 'finance'
      ? { buttonSelector: '[data-finance-tab]', panelSelector: '.finance-panel', buttonKey: 'financeTab', panelPrefix: 'finance-' }
      : { buttonSelector: '[data-report-tab]', panelSelector: '.report-panel', buttonKey: 'reportTab', panelPrefix: 'report-' };
    const target = $(config.panelPrefix + name);
    if (!target || !hasPermission(target.dataset.permission)) return;

    document.querySelectorAll(config.buttonSelector).forEach((button) => {
      const active = button.dataset[config.buttonKey] === name && !button.hidden;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(config.panelSelector).forEach((panel) => {
      const allowed = hasPermission(panel.dataset.permission);
      const active = panel === target && allowed;
      panel.hidden = !allowed || !active;
      panel.classList.toggle('active', active);
    });
  }

  $('internalNav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) goTo(button.dataset.tab);
  });
  document.querySelectorAll('[data-finance-tab]').forEach((button) => {
    button.addEventListener('click', () => setSubtab('finance', button.dataset.financeTab));
  });
  document.querySelectorAll('[data-report-tab]').forEach((button) => {
    button.addEventListener('click', () => setSubtab('report', button.dataset.reportTab));
  });
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => {
    if (button.classList.contains('quick-action') && button.dataset.go === 'pacientes') clearPatientForm();
    goTo(button.dataset.go);
    if (button.dataset.go === 'agenda' && (button.classList.contains('quick-action') || button.closest('.heading-actions'))) {
      $('appointmentForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('bookingPatient').focus({ preventScroll: true });
    }
    if (button.classList.contains('quick-action') && button.dataset.go === 'pacientes') $('patientName').focus();
  }));
  $('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } finally { window.location.replace('/'); }
  });

  async function loadDashboard() {
    const stopLoading = showSkeleton($('overviewStats'), 'Carregando indicadores da clínica', 4);
    try {
      const metrics = await api('/api/dashboard');
      const cards = [
        ['Consultas hoje', metrics.consultas_hoje, 'calendar', Number(metrics.consultas_hoje) ? 'Na agenda de hoje' : 'Nenhuma consulta hoje'],
        ['Aguardando confirmação', metrics.aguardando_confirmacao, 'clock', Number(metrics.aguardando_confirmacao) ? 'Aguardando a clínica' : 'Sem pendências'],
        ['Agendadas on-line (7 dias)', metrics.online_7_dias, 'calendar', 'Próximos 7 dias'],
        ['Pacientes cadastrados', metrics.pacientes, 'patients', 'Total de pacientes'],
      ];
      if (isOwner && metrics.financeiro) cards.push(['Recebido hoje', money(metrics.financeiro.recebido_hoje), 'wallet', 'Recebimentos do dia']);
      if (hasPermission('estoque')) cards.push(['Itens para repor', metrics.itens_repor, 'stock', Number(metrics.itens_repor) ? 'Atenção ao estoque' : 'Estoque regular']);
      $('overviewStats').innerHTML = cards.map((card) =>
        '<article class="metric-card"><div class="dashboard-metric-label"><span>' + adminIcon(card[2]) + '</span><small>' +
        escapeHtml(card[0]) + '</small></div><div class="dashboard-metric-value"><strong>' + escapeHtml(card[1]) + '</strong><span>' + escapeHtml(card[3]) + '</span></div></article>'
      ).join('');
      $('pendingAppointments').textContent = metrics.aguardando_confirmacao;
      $('pendingStock').textContent = metrics.itens_repor;
      const pending = (hasPermission('agenda') ? Number(metrics.aguardando_confirmacao) : 0) + (hasPermission('estoque') ? Number(metrics.itens_repor) : 0);
      $('pendingSummary').textContent = pending ? 'Selecione uma pendência para acompanhar.' : 'Nenhuma pendência no momento.';
      renderDashboardActivity(metrics.atividade || []);
      if (hasPermission('agenda')) {
        const from = dateISO();
        const to = dateISO(new Date(Date.now() + 7 * 86400000));
        const list = await api('/api/agendamentos?de=' + from + '&ate=' + to);
        const upcoming = list.filter((item) => !['CANCELADO', 'FALTOU', 'CONCLUIDO'].includes(item.status))
          .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).slice(0, 8);
        const head = '<table><thead><tr><th>Horário</th><th>Paciente</th><th>Serviço</th><th>Status</th></tr></thead>';
        $('overviewAppointments').innerHTML = upcoming.length ? head + '<tbody>' + upcoming.map((item) => '<tr><td><strong>' + escapeHtml(formatTime(item.hora)) + '</strong><small class="table-subtitle">' + escapeHtml(formatDate(item.data)) + '</small></td><td>' + escapeHtml(item.paciente_nome) + '</td><td>' + escapeHtml(item.procedimento_nome || 'Consulta podológica') + '</td><td>' + statusBadge(item.status) + '</td></tr>').join('') + '</tbody></table>' : head + '</table><div class="dashboard-empty"><span>' + adminIcon('calendar') + '</span><strong>Nenhuma consulta programada</strong><p>Os próximos atendimentos aparecerão aqui.</p><button class="button button-outline" type="button" data-dashboard-book>' + adminIcon('plus') + 'Agendar consulta</button></div>';
      }
    } catch (error) {
      $('overviewStats').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>';
    } finally { stopLoading(); }
  }

  $('overviewAppointments').addEventListener('click', (event) => {
    if (!event.target.closest('[data-dashboard-book]')) return;
    goTo('agenda');
    $('appointmentForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('bookingPatient').focus({ preventScroll: true });
  });

  function renderDashboardActivity(days) {
    if (!days.length) { $('dashboardActivity').innerHTML = '<p class="small-note">Sem dados de atividade disponíveis.</p>'; return; }
    const max = Math.max(1, ...days.map((day) => Number(day.total) || 0));
    const points = days.map((day, index) => (30 + index * 85) + ',' + (76 - (Number(day.total) || 0) / max * 62));
    $('dashboardActivity').innerHTML = '<svg viewBox="0 0 550 90" preserveAspectRatio="none" role="img" aria-label="Consultas agendadas por dia nos últimos sete dias"><path d="M30 14H540M30 45H540M30 76H540" stroke="#e1e8f2" stroke-width="1"/><text x="7" y="18" fill="#71809a" font-size="9">' + max + '</text><text x="9" y="80" fill="#71809a" font-size="9">0</text><polygon points="30,76 ' + points.join(' ') + ' 540,76" fill="#edf3fb"/><polyline points="' + points.join(' ') + '" fill="none" stroke="#5e8bc9" stroke-width="2" vector-effect="non-scaling-stroke"/>' + days.map((day, index) => '<circle cx="' + (30 + index * 85) + '" cy="' + (76 - (Number(day.total) || 0) / max * 62) + '" r="2.5" fill="#5e8bc9"><title>' + escapeHtml(formatDate(day.data)) + ': ' + Number(day.total) + ' consultas</title></circle>').join('') + '</svg><div class="chart-date-labels">' + days.map((day) => '<span>' + escapeHtml(formatDate(day.data).slice(0, 5)) + '</span>').join('') + '</div>';
  }

  function appointmentTable(items, actions = true) {
    return '<table><thead><tr><th>Paciente e serviço</th><th>Data e hora</th><th>Situação</th>' +
      (actions ? '<th>Ações</th>' : '') + '</tr></thead><tbody>' +
      items.map((item) => {
        let buttons = '';
        if (actions) {
          buttons += '<button type="button" class="button button-outline button-small" data-appointment-detail="' + escapeHtml(item.id) + '">Detalhes</button> ';
          if (item.status === 'AGENDADO') buttons += '<button class="button button-primary button-small" data-ag-status="CONFIRMADO" data-ag-id="' + escapeHtml(item.id) + '">Confirmar</button> ';
          if (item.status === 'CONFIRMADO' || item.status === 'AGENDADO') {
            if (hasPermission('atendimento')) buttons += '<button class="button button-outline button-small" data-care-id="' + escapeHtml(item.id) + '">Atender</button> ';
            buttons += '<button class="button button-outline button-small" data-ag-status="FALTOU" data-ag-id="' + escapeHtml(item.id) + '">Faltou</button> ';
            buttons += '<button class="button button-outline button-small" data-ag-status="CANCELADO" data-ag-id="' + escapeHtml(item.id) + '">Cancelar</button>';
          }
        }
        return '<tr><td><strong>' + escapeHtml(item.paciente_nome) + '</strong><small class="table-subtitle">' +
          escapeHtml(item.procedimento_nome || 'Consulta podológica') + '</small></td><td>' +
          escapeHtml(formatLongDate(item.data)) + '<strong class="table-time">' + escapeHtml(formatTime(item.hora)) + '</strong></td><td>' +
          statusBadge(item.status) + '<small class="table-subtitle">' + escapeHtml(item.origem) + '</small></td>' +
          (actions ? '<td class="table-actions">' + buttons + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function renderAppointments() {
    const items = state.appointments;
    $('appointmentList').innerHTML = items.length ? appointmentTable(items) : '<p class="empty">Nenhuma consulta neste período.</p>';
  }

  async function updateAppointmentStatus(id, status) {
    if (status === 'CANCELADO' && !window.confirm('Cancelar este agendamento?')) return false;
    await api('/api/agendamentos/' + encodeURIComponent(id) + '/status', { method: 'PATCH', body: { status } });
    toast(status === 'CONFIRMADO' ? 'Agendamento confirmado.' : 'Situação atualizada.', true);
    await Promise.all([loadAppointments($('agendaDateFrom').value, $('agendaDateTo').value), loadCalendar(calendarMonth)]);
    if (hasPermission('dashboard')) loadDashboard();
    return true;
  }

  async function startAppointmentCare(id) {
    if (hasPermission('atendimento')) {
      const item = await api('/api/agendamentos/' + encodeURIComponent(id));
      if (!item) return;
      if (!state.appointments.some((appointment) => String(appointment.id) === String(item.id))) state.appointments.push(item);
      $('carePatient').value = String(item.paciente_id);
      fillCareAppointments();
      $('careAppointment').value = String(item.id);
      $('careProcedure').value = String(item.procedimento_id || '');
      const procedure = state.procedures.find((p) => String(p.id) === String(item.procedimento_id));
      if (procedure) $('careValue').value = procedure.valor_referencia;
      goTo('atendimento');
    }
  }

  async function handleAppointmentActions(event) {
    const details = event.target.closest('[data-appointment-detail]');
    if (details) return agendaUI.openAppointment(details.dataset.appointmentDetail);
    const statusButton = event.target.closest('[data-ag-status]');
    const careButton = event.target.closest('[data-care-id]');
    if (statusButton) statusButton.disabled = true;
    try {
      if (statusButton && await updateAppointmentStatus(statusButton.dataset.agId, statusButton.dataset.agStatus)) await agendaUI.refreshNotifications();
      if (careButton) await startAppointmentCare(careButton.dataset.careId);
    } catch (error) { toast(error.message); }
    finally { if (statusButton) statusButton.disabled = false; }
  }
  $('appointmentList').addEventListener('click', handleAppointmentActions);
  $('calendarDayAppointments').addEventListener('click', handleAppointmentActions);

  function renderPatients(query = '') {
    const list = moduleViews.filterPatients(state.patients, query);
    moduleViews.updatePatientSummary(list.length);
    if (!list.length) {
      $('patientsTable').innerHTML = '<div class="module-empty"><span aria-hidden="true">' + adminIcon('patients') + '</span><h3>' + (state.patients.length ? 'Nenhum paciente encontrado' : 'Sua lista de pacientes começa aqui') + '</h3><p>' + (state.patients.length ? 'Tente outro nome, CPF ou filtro para localizar o cadastro.' : 'Cadastre o primeiro paciente para organizar as fichas e os atendimentos.') + '</p><button type="button" class="button button-outline" ' + (state.patients.length ? 'data-reset-patient-filters>Limpar busca e filtros' : 'data-new-patient-empty>Cadastrar paciente') + '</button></div>';
      return;
    }
    $('patientsTable').innerHTML = '<table><thead><tr><th>Paciente</th><th>CPF</th><th>Celular</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>' +
      list.map((patient) => '<tr><td><div class="module-patient-identity"><span class="module-patient-avatar" aria-hidden="true">' + escapeHtml(initials(patient.nome)) + '</span><div><strong>' + escapeHtml(patient.nome) + '</strong><small class="table-subtitle">' + escapeHtml(patient.email || 'E-mail não informado') +
        '</small></div></div></td><td class="module-cpf">' + escapeHtml(formatCpf(patient.cpf)) + '</td><td>' + escapeHtml(patient.telefone || 'Não informado') +
        '</td><td class="table-actions"><button class="button button-outline button-small module-row-primary" type="button" data-view-patient="' + escapeHtml(patient.id) + '" aria-label="Ver perfil de ' + escapeHtml(patient.nome) + '">Ver perfil</button> ' +
        '<button class="button button-outline button-small" type="button" data-edit-patient="' + escapeHtml(patient.id) + '">Editar</button></td></tr>').join('') +
      '</tbody></table>';
  }
  function patientProfileField(label, value) {
    return '<div class="patient-record-field"><small>' + escapeHtml(label) + '</small><strong>' + escapeHtml(value || 'Não informado') + '</strong></div>';
  }

  function renderStaffPatientProfile(record) {
    const patient = record.cadastro;
    const metrics = [];
    if (record.permissoes.agenda) metrics.push(['Consultas', record.resumo.consultas]);
    if (record.permissoes.atendimento) metrics.push(['Fichas de saúde', record.resumo.saude], ['Atendimentos', record.resumo.atendimentos]);
    if (record.permissoes.receitas) metrics.push(['Lançamentos', record.resumo.pagamentos]);
    const metricCards = metrics.map(([label, count]) => '<article class="patient-profile-metric"><strong>' + escapeHtml(count) + '</strong><small>' + escapeHtml(label) + '</small></article>').join('');
    const appointmentItems = record.consultas.map((item) => '<article class="patient-record-item"><strong>' + escapeHtml(formatLongDate(item.data) + ' às ' + formatTime(item.hora)) +
      '</strong>' + statusBadge(item.status) + '<p>' + escapeHtml(item.procedimento_nome || 'Consulta podológica') + ' · ' + escapeHtml(item.tipo === 'RETORNO' ? 'Retorno' : 'Consulta') +
      (item.observacao ? '<br>' + escapeHtml(item.observacao) : '') + '</p></article>').join('');
    const healthItems = record.saude.map((item) => '<article class="patient-record-item"><strong>Ficha de ' + escapeHtml(formatLongDate(item.data_preenchimento)) + '</strong>' +
      '<p><b>Queixa:</b> ' + escapeHtml(item.queixa_principal || 'Não informada') + '</p><p><b>Condições:</b> ' + escapeHtml([
        item.diabetico && 'Diabetes', item.hipertenso && 'Hipertensão', item.problema_circulatorio && 'Problema circulatório',
      ].filter(Boolean).join(', ') || 'Nenhuma sinalizada') + '</p>' + patientProfileField('Alergias', item.alergias) +
      patientProfileField('Medicamentos', item.medicamentos_em_uso) + patientProfileField('Cirurgias anteriores', item.cirurgias_anteriores) + '</article>').join('');
    const treatmentItems = record.atendimentos.map((item) => '<article class="patient-record-item"><strong>' + escapeHtml(formatLongDate(item.data) + ' às ' + formatTime(item.hora)) +
      '</strong>' + statusBadge(item.status) + '<p><b>' + escapeHtml(item.procedimentos || 'Atendimento podológico') + '</b>' +
      (item.valor_final != null ? ' · ' + money(item.valor_final) : '') + (item.queixa ? '<br>Queixa: ' + escapeHtml(item.queixa) : '') +
      (item.evolucao ? '<br>Evolução: ' + escapeHtml(item.evolucao) : '') + (item.orientacoes ? '<br>Orientações: ' + escapeHtml(item.orientacoes) : '') + '</p></article>').join('');
    const paymentItems = record.pagamentos.map((item) => '<article class="patient-record-item"><strong>' + escapeHtml(item.descricao || item.categoria || 'Lançamento') +
      '</strong>' + statusBadge(item.status) + '<p>' + escapeHtml(money(item.valor)) + ' · ' + escapeHtml(item.status === 'PAGO' ? 'Pago em ' + formatLongDate(item.data_pagamento) : 'Lançado em ' + formatLongDate(item.data)) + '</p></article>').join('');
    const section = (title, items, empty) => '<section class="patient-record-section"><h3>' + title + '</h3>' + (items || '<p class="empty">' + empty + '</p>') + '</section>';
    $('staffPatientTitle').textContent = patient.nome;
    $('staffPatientProfile').innerHTML = '<section class="patient-profile-overview"><div class="patient-profile-header"><span class="patient-profile-avatar">' + escapeHtml(initials(patient.nome)) +
      '</span><div><h3>' + escapeHtml(patient.nome) + '</h3><span class="log-status">Paciente</span><small>Paciente desde ' + escapeHtml(formatLongDate(patient.data_cadastro)) + '</small></div></div>' +
      '<div class="patient-record-grid">' + patientProfileField('CPF', formatCpf(patient.cpf)) + patientProfileField('Celular / WhatsApp', patient.telefone) +
      patientProfileField('E-mail', patient.email) + patientProfileField('Nascimento', patient.data_nascimento ? formatLongDate(patient.data_nascimento) : '') +
      patientProfileField('Endereço', patient.endereco) + '</div></section>' +
      (isOwner ? '<section class="patient-record-section"><h3>Acesso ao portal</h3><p>Após conferir a identidade do paciente e, para menores, a autorização dos pais, gere um convite individual. Ele vale por 24 horas e só pode ser usado uma vez. Entregue o link diretamente ao paciente ou aos pais.</p><button type="button" class="button button-outline" data-create-portal-invite="' + escapeHtml(patient.id) + '">Gerar convite de acesso</button><div id="portalInviteResult" aria-live="polite"></div></section>' : '') +
      (metricCards ? '<div class="patient-profile-metrics">' + metricCards + '</div>' : '') +
      (record.permissoes.agenda ? section('Consultas', appointmentItems, 'Nenhuma consulta registrada.') : '') +
      (record.permissoes.atendimento ? section('Fichas de saúde', healthItems, 'Nenhuma ficha de saúde registrada.') + section('Atendimentos e evoluções', treatmentItems, 'Nenhum atendimento registrado.') : '') +
      (record.permissoes.receitas ? section('Receitas e pagamentos', paymentItems, 'Nenhum lançamento relacionado.') : '');
  }

  async function openStaffPatientProfile(patientId) {
    $('staffPatientDialog').showModal();
    const stopLoading = showSkeleton($('staffPatientProfile'), 'Carregando informações do paciente');
    try {
      renderStaffPatientProfile(await api('/api/pacientes/' + encodeURIComponent(patientId) + '/perfil'));
    } catch (error) { $('staffPatientProfile').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>'; }
    finally { stopLoading(); }
  }
  $('staffPatientProfile').addEventListener('click', async event => {
    const button = event.target.closest('[data-create-portal-invite]');
    if (!button) return;
    button.disabled = true;
    const result = $('portalInviteResult');
    try {
      const invitation = await api('/api/pacientes/' + encodeURIComponent(button.dataset.createPortalInvite) + '/convite-portal', { method: 'POST', body: {} });
      const link = new URL('/cadastro.html', window.location.origin);
      link.searchParams.set('convite', invitation.token);
      result.innerHTML = '<label>Link individual para copiar<input readonly id="portalInviteLink" value="' + escapeHtml(link.href) + '"></label><p>Válido por 24 horas. Um novo convite invalida o anterior.</p>';
      $('portalInviteLink').focus(); $('portalInviteLink').select();
    } catch (error) { result.innerHTML = '<p class="form-message error" role="alert">' + escapeHtml(error.message) + '</p>'; }
    finally { button.disabled = false; }
  });
  $('closeStaffPatientDialog').addEventListener('click', () => $('staffPatientDialog').close());
  $('staffPatientDialog').addEventListener('click', (event) => { if (event.target === $('staffPatientDialog')) $('staffPatientDialog').close(); });

  let activeSearchResults = [];
  let searchRequest = 0;
  let searchTimer;
  function showGlobalSearchResults(results) {
    activeSearchResults = results;
    $('globalSearchResults').innerHTML = results.length ? results.map((item, index) =>
      '<button class="global-search-result" type="button" role="option" data-global-search-result="' + index + '"><span class="global-search-kind">' +
      escapeHtml(({ paciente: 'Paciente', consulta: 'Consulta', procedimento: 'Procedimento', produto: 'Produto' })[item.tipo] || 'Resultado') +
      '</span><strong>' + escapeHtml(item.titulo) + '</strong><small>' + escapeHtml(item.detalhe) + '</small></button>'
    ).join('') : '<p class="global-search-empty">Nenhum resultado encontrado.</p>';
    $('globalSearchResults').hidden = false;
  }
  $('globalSearchInput').addEventListener('input', (event) => {
    const query = event.currentTarget.value.trim();
    clearTimeout(searchTimer);
    const requestId = ++searchRequest;
    if (query.length < 2) { $('globalSearchResults').hidden = true; return; }
    $('globalSearchResults').innerHTML = '<p class="global-search-empty">Buscando…</p>';
    $('globalSearchResults').hidden = false;
    searchTimer = setTimeout(async () => {
      try {
        const response = await api('/api/busca?q=' + encodeURIComponent(query));
        if (requestId === searchRequest) showGlobalSearchResults(response.resultados);
      } catch (error) {
        if (requestId === searchRequest) showGlobalSearchResults([]);
      }
    }, 250);
  });
  $('globalSearchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $('globalSearchResults').hidden = true;
  });
  $('globalSearchResults').addEventListener('click', (event) => {
    const button = event.target.closest('[data-global-search-result]');
    if (!button) return;
    const result = activeSearchResults[Number(button.dataset.globalSearchResult)];
    $('globalSearchResults').hidden = true;
    if (result?.tipo === 'paciente') openStaffPatientProfile(result.id);
    if (result?.tipo === 'consulta') {
      selectedCalendarDate = result.data;
      calendarView = 'day';
      goTo('agenda');
    }
    if (result?.tipo === 'procedimento') {
      if (isOwner) goTo('servicos');
      else if (hasPermission('agenda')) { goTo('agenda'); $('bookingProcedure').value = result.id; updateBookingSlots(); }
      else if (hasPermission('atendimento')) { goTo('atendimento'); $('careProcedure').value = result.id; }
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#globalSearchWrap')) $('globalSearchResults').hidden = true;
  });

  $('patientSearch').addEventListener('input', (event) => renderPatients(event.currentTarget.value));
  $('patientCpf').addEventListener('input', (event) => { event.currentTarget.value = formatCpf(event.currentTarget.value); });
  function updateStaffGuardian() {
    const birth = $('patientBirth').value;
    const today = dateISO();
    const age = birth ? Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) : 18;
    const required = age < 18;
    $('staffGuardianFields').hidden = !required;
    ['staffGuardianName', 'staffGuardianCpf', 'staffGuardianConsent', 'staffGuardianRelationship'].forEach((id) => { $(id).required = required; });
  }
  $('patientBirth').addEventListener('change', updateStaffGuardian);
  $('staffGuardianCpf').addEventListener('input', (event) => { event.currentTarget.value = formatCpf(event.currentTarget.value); });
  $('patientsTable').addEventListener('click', (event) => {
    const view = event.target.closest('[data-view-patient]');
    if (view) { openStaffPatientProfile(view.dataset.viewPatient); return; }
    const button = event.target.closest('[data-edit-patient]');
    if (!button) return;
    const patient = state.patients.find((item) => String(item.id) === button.dataset.editPatient);
    if (!patient) return;
    $('patientId').value = patient.id;
    $('patientName').value = patient.nome;
    $('patientCpf').value = formatCpf(patient.cpf);
    $('patientBirth').value = patient.data_nascimento || '';
    $('staffGuardianName').value = '';
    $('staffGuardianCpf').value = '';
    $('staffGuardianConsent').checked = false;
    $('staffGuardianRelationship').value = '';
    updateStaffGuardian();
    $('patientPhone').value = patient.telefone || '';
    $('patientEmail').value = patient.email || '';
    $('patientAddress').value = patient.endereco || '';
    $('patientFormTitle').textContent = 'Editar paciente';
    goTo('pacientes');
    moduleViews.openPatientEditor(button);
  });
  $('clearPatientForm').addEventListener('click', clearPatientForm);
  function clearPatientForm() {
    $('patientForm').reset();
    $('patientId').value = '';
    $('patientFormTitle').textContent = 'Novo paciente';
    updateStaffGuardian();
    setMessage($('patientMessage'), '');
  }
  $('patientForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('patientId').value;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const body = {
        nome: $('patientName').value.trim(),
        cpf: cpfDigits($('patientCpf').value),
        nascimento: $('patientBirth').value || null,
        responsavelNome: $('staffGuardianName').value.trim(),
        responsavelCpf: cpfDigits($('staffGuardianCpf').value),
        consentimentoResponsavel: $('staffGuardianConsent').checked,
        responsavelVinculo: $('staffGuardianRelationship').value,
        telefone: $('patientPhone').value.trim(),
        email: $('patientEmail').value.trim(),
        endereco: $('patientAddress').value.trim(),
      };
      await api(id ? '/api/pacientes/' + encodeURIComponent(id) : '/api/pacientes', { method: id ? 'PUT' : 'POST', body });
      clearPatientForm();
      await loadPatients();
      moduleViews.closePatientEditor();
      toast(id ? 'Cadastro atualizado.' : 'Paciente cadastrado.', true);
    } catch (error) {
      setMessage($('patientMessage'), error.message);
    } finally { button.disabled = false; }
  });

  async function updateBookingSlots() {
    const date = $('bookingDate').value;
    const procedure = $('bookingProcedure').value;
    const select = $('bookingTime');
    if (!date || !procedure) {
      select.innerHTML = '<option value="">Escolha data e serviço</option>';
      return;
    }
    select.innerHTML = '<option value="">Consultando horários…</option>';
    try {
      const result = await api('/api/agendamentos/disponibilidade?procedimentoId=' + encodeURIComponent(procedure) +
        '&de=' + encodeURIComponent(date) + '&ate=' + encodeURIComponent(date));
      const day = result.dias.find((item) => item.data === date);
      select.innerHTML = day && day.horarios.length
        ? optionList(day.horarios.map((hora) => ({ hora })), 'Selecione um horário', (item) => item.hora, (item) => item.hora)
        : '<option value="">Sem horários livres nesta data</option>';
    } catch (error) {
      select.innerHTML = '<option value="">' + escapeHtml(error.message) + '</option>';
    }
  }
  $('bookingDate').min = dateISO();
  $('bookingDate').value = dateISO();
  $('bookingDate').addEventListener('change', updateBookingSlots);
  $('bookingProcedure').addEventListener('change', updateBookingSlots);
  $('appointmentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage($('appointmentMessage'), 'Salvando agendamento…', true);
    try {
      await api('/api/agendamentos', {
        method: 'POST',
        body: {
          pacienteId: $('bookingPatient').value,
          procedimentoId: $('bookingProcedure').value,
          tipo: $('bookingType').value,
          origem: $('bookingOrigin').value,
          data: $('bookingDate').value,
          hora: $('bookingTime').value,
          observacao: $('bookingNote').value.trim(),
        },
      });
      form.reset();
      $('bookingDate').value = dateISO();
      $('bookingDate').min = dateISO();
      $('bookingTime').innerHTML = '<option value="">Escolha data e serviço</option>';
      setMessage($('appointmentMessage'), 'Agendamento registrado e confirmado.', true);
      await loadAppointments($('agendaDateFrom').value, $('agendaDateTo').value);
      await loadCalendar(calendarMonth);
      if (hasPermission('dashboard')) loadDashboard();
    } catch (error) {
      setMessage($('appointmentMessage'), error.message);
      renderSuggestionButtons(error.sugestoes);
      if (error.status === 409) updateBookingSlots();
    } finally { button.disabled = false; }
  });

  function renderSuggestionButtons(sugestoes) {
    const destination = $('appointmentSuggestions');
    if (!destination) return;
    if (!sugestoes || !sugestoes.length) { destination.innerHTML = ''; return; }
    destination.innerHTML = '<p class="small-note">Horários disponíveis:</p>' + sugestoes.map((item) =>
      '<button class="chip-button" type="button" data-suggest-date="' + escapeHtml(item.data) +
      '" data-suggest-time="' + escapeHtml(item.hora) + '">' + escapeHtml(formatDate(item.data)) + ' · ' + escapeHtml(item.hora) + '</button>'
    ).join('');
    destination.querySelectorAll('[data-suggest-date]').forEach((button) => button.addEventListener('click', () => {
      $('bookingDate').value = button.dataset.suggestDate;
      updateBookingSlots().then(() => { $('bookingTime').value = button.dataset.suggestTime; });
    }));
  }
  $('refreshAgenda').addEventListener('click', async () => {
    await loadAppointments($('agendaDateFrom').value, $('agendaDateTo').value);
    await loadCalendar(calendarMonth);
  });
  $('agendaDateFrom').value = dateISO();
  $('agendaDateTo').value = dateISO(new Date(Date.now() + 30 * 86400000));
  $('agendaBlockDate').min = dateISO();
  $('agendaBlockDate').value = dateISO();
  $('agendaBlockStart').value = '08:00';
  $('agendaBlockEnd').value = '18:00';
  $('agendaBlockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/agendamentos/bloqueios', { method: 'POST', body: { data: $('agendaBlockDate').value, inicio: $('agendaBlockStart').value, fim: $('agendaBlockEnd').value, motivo: $('agendaBlockReason').value.trim() } });
      selectedCalendarDate = $('agendaBlockDate').value;
      await loadCalendar(); await updateBookingSlots();
      setMessage($('agendaBlockMessage'), 'Horário bloqueado.', true);
    } catch (error) { setMessage($('agendaBlockMessage'), error.message); }
    finally { button.disabled = false; }
  });
  $('agendaBlockList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-block]');
    if (!button || !window.confirm('Liberar este intervalo para novos agendamentos?')) return;
    button.disabled = true;
    try { await api('/api/agendamentos/bloqueios/' + encodeURIComponent(button.dataset.removeBlock), { method: 'DELETE' }); await loadCalendar(); await updateBookingSlots(); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
  $('bookingShareUrl').value = new URL('/agendar.html', window.location.origin).href;
  $('openBookingLink').href = $('bookingShareUrl').value;
  $('copyBookingLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('bookingShareUrl').value); toast('Link copiado.', true); }
    catch { $('bookingShareUrl').focus(); $('bookingShareUrl').select(); toast('Selecione e copie o endereço do link.'); }
  });

  async function loadAnamnesisHistory(patientId) {
    const destination = $('anamnesisHistory');
    if (!patientId) { destination.innerHTML = ''; return; }
    try {
      const rows = await api('/api/anamneses/' + encodeURIComponent(patientId));
      destination.innerHTML = rows.length ? rows.map((item) =>
        '<article class="history-card"><strong>Ficha de saúde · ' + escapeHtml(formatDate(item.data_preenchimento)) +
        '</strong><p>' + escapeHtml(item.queixa_principal || 'Sem queixa informada') + '</p><small>' +
        (item.diabetico ? 'Diabetes · ' : '') + (item.hipertenso ? 'Hipertensão · ' : '') +
        (item.problema_circulatorio ? 'Problema circulatório' : '') + '</small></article>'
      ).join('') : '<p class="empty">Não há ficha de anamnese registrada para este paciente.</p>';
    } catch (error) { destination.innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>'; }
  }
  $('anamnesisPatient').addEventListener('change', () => loadAnamnesisHistory($('anamnesisPatient').value));
  $('anamnesisForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/anamneses', { method: 'POST', body: {
        pacienteId: $('anamnesisPatient').value,
        queixaPrincipal: $('anamnesisComplaint').value.trim(),
        diabetico: $('anamnesisDiabetes').checked,
        hipertenso: $('anamnesisHypertension').checked,
        problemaCirculatorio: $('anamnesisCirculation').checked,
        alergias: $('anamnesisAllergies').value.trim(),
        medicamentos: $('anamnesisMedication').value.trim(),
        cirurgias: $('anamnesisSurgeries').value.trim(),
        tipoCalcado: $('anamnesisShoes').value.trim(),
        observacoes: $('anamnesisNotes').value.trim(),
      } });
      setMessage($('anamnesisMessage'), 'Ficha de saúde salva.', true);
      await loadAnamnesisHistory($('anamnesisPatient').value);
    } catch (error) { setMessage($('anamnesisMessage'), error.message); }
  });

  function fillCareAppointments() {
    if (!$('careAppointment')) return;
    const patientId = $('carePatient').value;
    const choices = state.appointments.filter((item) =>
      String(item.paciente_id) === String(patientId) && ['AGENDADO', 'CONFIRMADO'].includes(item.status)
    );
    $('careAppointment').innerHTML = optionList(choices, 'Atendimento sem agendamento', (item) => item.id,
      (item) => formatDate(item.data) + ' ' + formatTime(item.hora) + ' · ' + item.procedimento_nome);
  }
  $('carePatient').addEventListener('change', fillCareAppointments);
  $('careAppointment').addEventListener('change', () => {
    const selected = state.appointments.find((item) => String(item.id) === $('careAppointment').value);
    if (!selected) return;
    $('carePatient').value = String(selected.paciente_id);
    fillCareAppointments();
    $('careAppointment').value = String(selected.id);
    $('careProcedure').value = String(selected.procedimento_id || '');
    const service = state.procedures.find((item) => String(item.id) === String(selected.procedimento_id));
    if (service) $('careValue').value = service.valor_referencia;
  });
  $('careProcedure').addEventListener('change', () => {
    const procedure = state.procedures.find((item) => String(item.id) === $('careProcedure').value);
    if (procedure) $('careValue').value = procedure.valor_referencia;
  });

  async function loadTreatmentHistory() {
    const rows = await safe('/api/atendimentos');
    $('treatmentHistory').innerHTML = rows.length ? '<table><thead><tr><th>Paciente</th><th>Data</th><th>Procedimento</th><th>Valor</th></tr></thead><tbody>' +
      rows.slice(0, 25).map((item) => '<tr><td>' + escapeHtml(item.paciente_nome) + '</td><td>' +
        escapeHtml(formatDate(String(item.inicio).slice(0, 10))) + '</td><td><strong>' + escapeHtml(item.procedimentos || '—') +
        '</strong><small class="table-subtitle">' + escapeHtml(item.queixa || '') + '</small></td><td>' + money(item.valor_final) +
        '</td></tr>').join('') + '</tbody></table>' : '<p class="empty">Nenhum atendimento registrado.</p>';
  }
  $('treatmentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage($('treatmentMessage'), 'Salvando prontuário e lançamento a receber…', true);
    try {
      await api('/api/atendimentos', { method: 'POST', body: {
        pacienteId: $('carePatient').value,
        agendamentoId: $('careAppointment').value || null,
        procedimentoId: $('careProcedure').value,
        valorFinal: Number($('careValue').value),
        queixa: $('careComplaint').value.trim(),
        evolucao: $('careEvolution').value.trim(),
        orientacoes: $('careAdvice').value.trim(),
      } });
      form.reset();
      setMessage($('treatmentMessage'), 'Atendimento salvo. A receita foi lançada como a receber.', true);
      await Promise.all([loadTreatmentHistory(), loadAppointments($('agendaDateFrom').value, $('agendaDateTo').value), loadCalendar(calendarMonth), loadRevenues()]);
    } catch (error) { setMessage($('treatmentMessage'), error.message); }
    finally { button.disabled = false; }
  });

  const paymentOptions = '<option value="">Forma de pagamento</option><option value="PIX">Pix</option>' +
    '<option value="CARTAO_CREDITO">Cartão de crédito</option><option value="CARTAO_DEBITO">Cartão de débito</option>' +
    '<option value="DINHEIRO">Dinheiro</option><option value="BOLETO">Boleto</option><option value="TRANSFERENCIA">Transferência</option>';

  async function loadRevenues() {
    if (!hasPermission('receitas')) return;
    const status = $('revenueFilter').value;
    const rows = await safe('/api/financeiro/receitas' + (status ? '?status=' + status : ''));
    $('revenueList').innerHTML = rows.length ? '<table><thead><tr><th>Receita</th><th>Paciente</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>' +
      rows.map((item) => '<tr><td><strong>' + escapeHtml(item.descricao) + '</strong><small class="table-subtitle">' + escapeHtml(item.categoria) +
        ' · ' + escapeHtml(formatDate(item.data_lancamento)) + '</small></td><td>' + escapeHtml(item.paciente_nome || '—') +
        '</td><td>' + money(item.valor) + '</td><td>' + statusBadge(item.status) + '</td><td>' +
        (item.status === 'PENDENTE' ? '<div class="inline-payment"><select aria-label="Forma de pagamento" data-revenue-method="' + escapeHtml(item.id) + '">' + paymentOptions +
          '</select><button class="button button-outline button-small" data-revenue-pay="' + escapeHtml(item.id) + '">Receber</button></div>' : '') +
        '</td></tr>').join('') + '</tbody></table>' : '<p class="empty">Nenhuma receita registrada.</p>';
  }
  $('revenueFilter').addEventListener('change', loadRevenues);
  $('revenueForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/financeiro/receitas', { method: 'POST', body: {
        descricao: $('revenueDescription').value.trim(),
        categoria: $('revenueCategory').value,
        pacienteId: $('revenuePatient').value || null,
        valor: Number($('revenueAmount').value),
        status: $('revenueStatus').value,
        formaPagamento: $('revenueMethod').value,
      } });
      form.reset();
      setMessage($('revenueMessage'), 'Receita registrada.', true);
      await loadRevenues();
      if (hasPermission('dashboard')) loadDashboard();
    } catch (error) { setMessage($('revenueMessage'), error.message); }
  });
  $('revenueList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-revenue-pay]');
    if (!button) return;
    const select = $('revenueList').querySelector('[data-revenue-method="' + button.dataset.revenuePay + '"]');
    if (!select.value) { toast('Escolha a forma de pagamento.'); return; }
    try {
      await api('/api/financeiro/receitas/' + encodeURIComponent(button.dataset.revenuePay) + '/pagar', { method: 'PATCH', body: { formaPagamento: select.value } });
      toast('Recebimento registrado.', true);
      await loadRevenues();
      if (hasPermission('dashboard')) loadDashboard();
    } catch (error) { toast(error.message); }
  });

  $('expenseRepeat').addEventListener('change', () => {
    $('installmentField').hidden = $('expenseRepeat').value !== 'parcelado';
  });
  async function loadExpenses() {
    if (!hasPermission('despesas')) return;
    const rows = await safe('/api/financeiro/despesas');
    $('expenseList').innerHTML = rows.length ? '<table><thead><tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>' +
      rows.map((item) => '<tr><td><strong>' + escapeHtml(item.descricao) + '</strong><small class="table-subtitle">' + escapeHtml(item.categoria) +
        (item.parcela ? ' · parcela ' + escapeHtml(item.parcela) : '') + '</small></td><td>' + escapeHtml(formatDate(item.vencimento)) +
        '</td><td>' + money(item.valor) + '</td><td>' + statusBadge(item.status) + '</td><td>' +
        (item.status !== 'PAGA' ? '<div class="inline-payment"><select aria-label="Forma de pagamento" data-expense-method="' + escapeHtml(item.id) + '">' + paymentOptions +
          '</select><button class="button button-outline button-small" data-expense-pay="' + escapeHtml(item.id) + '">Pagar</button></div>' : '') +
        '</td></tr>').join('') + '</tbody></table>' : '<p class="empty">Nenhuma conta a pagar cadastrada.</p>';
  }
  $('expenseForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/financeiro/despesas', { method: 'POST', body: {
        descricao: $('expenseDescription').value.trim(),
        categoria: $('expenseCategory').value,
        fornecedor: $('expenseSupplier').value.trim(),
        valor: Number($('expenseAmount').value),
        vencimento: $('expenseDue').value,
        recorrencia: $('expenseRepeat').value,
        quantidadeParcelas: Number($('expenseInstallments').value || 1),
      } });
      form.reset();
      $('installmentField').hidden = true;
      setMessage($('expenseMessage'), 'Conta registrada.', true);
      await loadExpenses();
    } catch (error) { setMessage($('expenseMessage'), error.message); }
  });
  $('expenseList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-expense-pay]');
    if (!button) return;
    const select = $('expenseList').querySelector('[data-expense-method="' + button.dataset.expensePay + '"]');
    if (!select.value) { toast('Escolha a forma de pagamento.'); return; }
    try {
      const result = await api('/api/financeiro/despesas/' + encodeURIComponent(button.dataset.expensePay) + '/pagar', { method: 'PATCH', body: { formaPagamento: select.value } });
      toast(result.proximaConta ? 'Pagamento registrado e próxima mensalidade criada.' : 'Pagamento registrado.', true);
      await loadExpenses();
    } catch (error) { toast(error.message); }
  });

  async function loadMovements() {
    const rows = await safe('/api/estoque/movimentacoes?dias=30');
    $('stockMovements').innerHTML = rows.length ? '<table><thead><tr><th>Material</th><th>Movimento</th><th>Quando</th><th>Registrado por</th></tr></thead><tbody>' +
      rows.slice(0, 25).map((item) => '<tr><td><strong>' + escapeHtml(item.produto_nome) + '</strong><small class="table-subtitle">' +
        escapeHtml(item.motivo || '') + '</small></td><td><span class="movement-type ' + item.tipo.toLowerCase() + '">' +
        (item.tipo === 'ENTRADA' ? '+' : '−') + escapeHtml(item.quantidade) + ' ' + escapeHtml(item.unidade_medida || '') +
        '</span></td><td>' + escapeHtml(formatDate(String(item.data_hora).slice(0, 10))) + '</td><td>' + escapeHtml(item.usuario_nome || '—') +
        '</td></tr>').join('') + '</tbody></table>' : '<p class="empty">Nenhuma movimentação nos últimos 30 dias.</p>';
  }
  function renderProducts() {
    const list = state.products;
    $('stockProducts').innerHTML = list.length ? '<table><thead><tr><th>Material</th><th>Quantidade atual</th><th>Mínimo</th><th></th></tr></thead><tbody>' +
      list.map((item) => '<tr><td><strong>' + escapeHtml(item.nome) + '</strong>' +
        (Number(item.quantidade_atual) <= Number(item.estoque_minimo) ? '<small class="table-subtitle text-danger">Precisa de reposição</small>' : '') +
        '</td><td>' + escapeHtml(item.quantidade_atual) + ' ' + escapeHtml(item.unidade_medida) + '</td><td>' +
        escapeHtml(item.estoque_minimo) + ' ' + escapeHtml(item.unidade_medida) + '</td><td><button class="button button-outline button-small" data-edit-stock="' +
        escapeHtml(item.id) + '">Editar</button></td></tr>').join('') + '</tbody></table>' : '<p class="empty">Cadastre os materiais usados pela clínica.</p>';
    $('movementProduct').innerHTML = optionList(list, 'Selecione um produto', (p) => p.id,
      (p) => p.nome + ' (' + p.quantidade_atual + ' ' + p.unidade_medida + ')');
  }
  $('stockProducts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-edit-stock]');
    if (!button) return;
    const product = state.products.find((item) => String(item.id) === button.dataset.editStock);
    if (!product) return;
    state.editProductId = String(product.id);
    $('productName').value = product.nome;
    $('productUnit').value = product.unidade_medida;
    $('productMinimum').value = product.estoque_minimo;
    $('productInitial').value = 0;
    $('productInitial').disabled = true;
    $('productReason').disabled = true;
    $('productForm').querySelector('button[type="submit"]').textContent = 'Atualizar material';
  });
  $('productForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const editing = state.editProductId;
    try {
      const body = {
        nome: $('productName').value.trim(),
        unidadeMedida: $('productUnit').value.trim() || 'un',
        estoqueMinimo: Number($('productMinimum').value || 0),
        quantidadeInicial: Number($('productInitial').value || 0),
        motivo: $('productReason').value.trim(),
      };
      await api(editing ? '/api/estoque/produtos/' + encodeURIComponent(editing) : '/api/estoque/produtos', { method: editing ? 'PUT' : 'POST', body });
      form.reset();
      state.editProductId = null;
      $('productInitial').disabled = false;
      $('productReason').disabled = false;
      $('productForm').querySelector('button[type="submit"]').textContent = 'Salvar produto';
      $('productMinimum').value = '0';
      $('productInitial').value = '0';
      await Promise.all([loadProducts(), loadMovements()]);
      toast(editing ? 'Material atualizado.' : 'Produto cadastrado.', true);
    } catch (error) { setMessage($('productMessage'), error.message); }
  });
  $('movementForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/estoque/movimentacoes', { method: 'POST', body: {
        produtoId: $('movementProduct').value,
        atendimentoId: $('movementAttendance').value || null,
        tipo: $('movementType').value,
        quantidade: Number($('movementQuantity').value),
        motivo: $('movementReason').value.trim(),
      } });
      form.reset();
      await Promise.all([loadProducts(), loadMovements()]);
      setMessage($('movementMessage'), 'Movimentação registrada e saldo atualizado.', true);
      if (hasPermission('dashboard')) loadDashboard();
    } catch (error) { setMessage($('movementMessage'), error.message); }
  });
  function fillStockAttendance() {
    const list = state.appointments.filter((item) => ['AGENDADO', 'CONFIRMADO', 'CONCLUIDO'].includes(item.status));
    $('movementAttendance').innerHTML = optionList(list, 'Sem atendimento relacionado', (item) => item.id,
      (item) => formatDate(item.data) + ' · ' + item.paciente_nome);
  }

  async function loadFinancialReport() {
    if (!hasPermission('relatorio_financeiro')) return;
    const months = Number($('financialPeriod').value || 6);
    const today = new Date();
    const end = dateISO(today);
    const startDate = new Date(today.getFullYear(), today.getMonth() - months + 1, 1);
    const start = dateISO(startDate);
    try {
      const result = await api('/api/relatorios/financeiro?de=' + start + '&ate=' + end);
      const summary = result.resumo;
      const chartMax = Math.max(1, ...result.meses.flatMap((month) => [Number(month.recebido), Number(month.pago)]));
      const chart = result.meses.map((month) => {
        const receivedHeight = Math.max(2, Number(month.recebido) / chartMax * 100);
        const paidHeight = Math.max(2, Number(month.pago) / chartMax * 100);
        return '<div class="chart-month"><div class="chart-bars"><span class="chart-bar received" style="height:' + receivedHeight +
          '%" title="Recebido ' + money(month.recebido) + '"></span><span class="chart-bar paid" style="height:' + paidHeight +
          '%" title="Pago ' + money(month.pago) + '"></span></div><small>' + escapeHtml(new Intl.DateTimeFormat('pt-BR', { month: 'short' })
          .format(new Date(String(month.mes).slice(0, 10) + 'T12:00:00'))) + '</small></div>';
      }).join('');
      $('financialReport').innerHTML =
        '<div class="report-metrics"><article class="metric-card metric-primary"><small>Recebido no período</small><strong>' + money(summary.recebido) +
        '</strong></article><article class="metric-card"><small>Despesas pagas</small><strong>' + money(summary.despesas_pagas) +
        '</strong></article><article class="metric-card"><small>Saldo</small><strong class="text-positive">' + money(Number(summary.recebido) - Number(summary.despesas_pagas)) +
        '</strong></article><article class="metric-card"><small>A receber hoje</small><strong>' + money(summary.a_receber_hoje) +
        '</strong></article><article class="metric-card"><small>A pagar hoje</small><strong>' + money(summary.a_pagar_hoje) +
        '</strong><small>' + (Number(summary.vencido) > 0 ? 'Vencido: ' + money(summary.vencido) : 'Nada vencido') + '</small></article></div>' +
        '<div class="content-card chart-card"><div class="card-heading"><div><p class="eyebrow">Regime de caixa</p><h2>Recebido e pago por mês</h2></div><span class="chart-legend"><i class="legend-received"></i> Recebido <i class="legend-paid"></i> Pago</span></div>' +
        (chart ? '<div class="bar-chart">' + chart + '</div>' : '<p class="empty">Ainda não há lançamentos pagos neste período.</p>') +
        '<details class="data-details"><summary>Ver dados em tabela</summary><table><thead><tr><th>Mês</th><th>Recebido</th><th>Pago</th><th>Saldo</th></tr></thead><tbody>' +
        result.meses.map((month) => '<tr><td>' + escapeHtml(formatDate(month.mes).slice(3)) + '</td><td>' + money(month.recebido) + '</td><td>' +
          money(month.pago) + '</td><td>' + money(month.saldo) + '</td></tr>').join('') +
        '</tbody></table></details></div>';
    } catch (error) { $('financialReport').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>'; }
  }

  async function loadStockReport() {
    if (!hasPermission('relatorio_estoque')) return;
    const days = Number($('stockPeriod').value || 30);
    try {
      const result = await api('/api/relatorios/estoque?dias=' + days);
      $('stockReport').innerHTML = '<div class="report-metrics"><article class="metric-card metric-primary"><small>Materiais cadastrados</small><strong>' +
        result.resumo.materiais + '</strong></article><article class="metric-card"><small>Precisam de reposição</small><strong class="text-danger">' +
        result.resumo.repor + '</strong></article><article class="metric-card"><small>Entradas no período</small><strong>' + result.resumo.entradas +
        '</strong></article><article class="metric-card"><small>Saídas no período</small><strong>' + result.resumo.saidas + '</strong></article></div>' +
        '<div class="content-card"><div class="card-heading"><div><p class="eyebrow">Estoque atual</p><h2>Situação dos materiais</h2></div></div>' +
        (result.produtos.length ? '<div class="table-wrap"><table><thead><tr><th>Material</th><th>Quantidade atual</th><th>Mínimo</th><th>Entradas</th><th>Saídas</th><th>Situação</th></tr></thead><tbody>' +
          result.produtos.map((item) => '<tr><td>' + escapeHtml(item.nome) + '</td><td>' + escapeHtml(item.quantidade_atual) + ' ' + escapeHtml(item.unidade_medida) +
            '</td><td>' + escapeHtml(item.estoque_minimo) + ' ' + escapeHtml(item.unidade_medida) + '</td><td>+' + escapeHtml(item.entradas) +
            '</td><td>−' + escapeHtml(item.saidas) + '</td><td><span class="status-pill ' +
            (item.situacao === 'Repor' ? 'status-stock-low' : 'status-stock-ok') + '">' + escapeHtml(item.situacao) + '</span>' +
            '</td></tr>').join('') + '</tbody></table></div>' : '<p class="empty">Nenhum produto cadastrado.</p>') +
        '</div><div class="content-card"><div class="card-heading"><div><p class="eyebrow">Auditoria</p><h2>Entradas e saídas do período</h2></div></div>' +
        (result.movimentacoes.length ? '<div class="table-wrap"><table><thead><tr><th>Material</th><th>Movimento</th><th>Data</th><th>Motivo</th><th>Registrado por</th></tr></thead><tbody>' +
          result.movimentacoes.map((item) => '<tr><td>' + escapeHtml(item.produto_nome) + '</td><td>' + escapeHtml(item.tipo) + ' ' + escapeHtml(item.quantidade) +
            ' ' + escapeHtml(item.unidade_medida) + '</td><td>' + escapeHtml(formatDate(String(item.data_hora).slice(0, 10))) + '</td><td>' +
            escapeHtml(item.motivo || '—') + '</td><td>' + escapeHtml(item.usuario_nome || '—') + '</td></tr>').join('') +
          '</tbody></table></div>' : '<p class="empty">Nenhuma movimentação neste período.</p>') + '</div>';
    } catch (error) { $('stockReport').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>'; }
  }
  $('financialPeriod').addEventListener('change', loadFinancialReport);
  $('stockPeriod').addEventListener('change', loadStockReport);
  $('printFinancial').addEventListener('click', () => window.print());
  $('printStock').addEventListener('click', () => window.print());

  let accessProfiles = [];
  const profilePermissionLabels = new Map();

  function clearProfileForm() {
    $('profileForm').reset();
    $('profileId').value = '';
    $('saveProfileButton').textContent = 'Salvar perfil';
    $('cancelProfileEdit').hidden = true;
    setMessage($('profileMessage'), '');
  }

  async function loadProfiles() {
    const result = await safe('/api/usuarios/perfis', { permissoesDisponiveis: [], perfis: [] });
    accessProfiles = result.perfis || [];
    profilePermissionLabels.clear();
    profilePermissionLabels.set('usuarios', 'Usuários');
    $('profilePermissions').innerHTML = (result.permissoesDisponiveis || []).map((permission) => {
      profilePermissionLabels.set(permission.key, permission.label);
      return '<label class="permission-option"><input type="checkbox" data-profile-permission="' + escapeHtml(permission.key) + '"><span>' +
        escapeHtml(permission.label) + '</span></label>';
    }).join('');
    $('staffProfile').innerHTML = optionList(accessProfiles, 'Selecione um perfil', (item) => item.id, (item) => item.nome);
    $('profilesList').innerHTML = accessProfiles.length ? '<div class="profile-list-items">' + accessProfiles.map((item) => {
      const permissionsText = (item.permissoes || []).map((permission) => profilePermissionLabels.get(permission) || permission).join(' · ');
      return '<article class="profile-list-item"><div><strong>' + escapeHtml(item.nome) + '</strong>' +
        (item.sistema ? '<span class="profile-default-tag">Padrão</span>' : '') +
        '<small>' + escapeHtml(permissionsText) + '</small><small>' + item.usuarios + (item.usuarios === 1 ? ' usuário' : ' usuários') + '</small></div>' +
        '<div class="profile-list-actions"><button class="button button-outline button-small" type="button" data-edit-profile="' + escapeHtml(item.id) + '">Editar</button>' +
        (item.sistema ? '' : '<button class="button button-outline button-small" type="button" data-delete-profile="' + escapeHtml(item.id) + '"' +
          (item.usuarios ? ' disabled title="Altere o perfil dos usuários vinculados antes de remover"' : '') + '>Remover</button>') +
        '</div></article>';
    }).join('') + '</div>' : '<p class="empty">Não há perfis. Confira a migração do banco de dados.</p>';
  }

  $('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('profileId').value;
    const permissoes = [...document.querySelectorAll('[data-profile-permission]:checked')].map((input) => input.dataset.profilePermission);
    const button = $('saveProfileButton');
    button.disabled = true;
    try {
      await api(id ? '/api/usuarios/perfis/' + encodeURIComponent(id) : '/api/usuarios/perfis', {
        method: id ? 'PUT' : 'POST',
        body: { nome: $('profileName').value.trim(), permissoes },
      });
      clearProfileForm();
      await loadProfiles();
      toast(id ? 'Perfil atualizado.' : 'Perfil criado.', true);
    } catch (error) { setMessage($('profileMessage'), error.message); }
    finally { button.disabled = false; }
  });

  $('profilesList').addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-profile]');
    if (edit) {
      const profileToEdit = accessProfiles.find((item) => String(item.id) === edit.dataset.editProfile);
      if (!profileToEdit) return;
      $('profileId').value = profileToEdit.id;
      $('profileName').value = profileToEdit.nome;
      document.querySelectorAll('[data-profile-permission]').forEach((input) => {
        input.checked = profileToEdit.permissoes.includes(input.dataset.profilePermission);
      });
      $('saveProfileButton').textContent = 'Salvar alterações';
      $('cancelProfileEdit').hidden = false;
      $('profileName').focus();
      return;
    }
    const remove = event.target.closest('[data-delete-profile]');
    if (!remove || remove.disabled) return;
    if (!window.confirm('Remover este perfil de acesso?')) return;
    try {
      await api('/api/usuarios/perfis/' + encodeURIComponent(remove.dataset.deleteProfile), { method: 'DELETE' });
      await loadProfiles();
      toast('Perfil removido.', true);
    } catch (error) { toast(error.message); }
  });
  $('cancelProfileEdit').addEventListener('click', clearProfileForm);

  async function loadUsers() {
    const users = await safe('/api/usuarios');
    $('usersList').innerHTML = users.length ? '<table><thead><tr><th>Conta</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>' +
      users.map((user) => '<tr><td><strong>' + escapeHtml(user.nome) + '</strong><small class="table-subtitle">' + escapeHtml(user.email) +
        '</small></td><td>' + escapeHtml(user.perfilNome || user.perfil) + (user.pacienteNome ? '<small class="table-subtitle">' + escapeHtml(user.pacienteNome) + '</small>' : '') +
        '</td><td>' + statusBadge(user.ativo ? 'ATIVO' : 'INATIVO') + '</td><td>' +
        (user.perfil !== 'PODOLOGA' ? '<button class="button button-outline button-small" data-toggle-user="' + escapeHtml(user.id) +
          '" data-active="' + (!user.ativo) + '">' + (user.ativo ? 'Desativar' : 'Ativar') + '</button>' : '') +
        '</td></tr>').join('') + '</tbody></table>' : '<p class="empty">Nenhuma conta cadastrada.</p>';
  }
  $('userForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/usuarios', { method: 'POST', body: {
        nome: $('staffName').value.trim(),
        email: $('staffEmail').value.trim(),
        senha: $('staffPassword').value,
        perfilId: $('staffProfile').value,
      } });
      form.reset();
      setMessage($('userMessage'), 'Usuário criado com o perfil selecionado.', true);
      await loadUsers();
    } catch (error) { setMessage($('userMessage'), error.message); }
  });
  $('usersList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-toggle-user]');
    if (!button) return;
    try {
      await api('/api/usuarios/' + encodeURIComponent(button.dataset.toggleUser) + '/ativo', {
        method: 'PATCH', body: { ativo: button.dataset.active === 'true' },
      });
      await loadUsers();
      toast(button.dataset.active === 'true' ? 'Conta ativada.' : 'Conta desativada.', true);
    } catch (error) { toast(error.message); }
  });

  const moduleViews = initModuleViews({
    getPatients: () => state.patients,
    getProducts: () => state.products,
    onPatientFilter: () => renderPatients($('patientSearch').value),
    onNewPatient: clearPatientForm,
  });
  $('stockPeriod').value = '30';
  $('expenseDue').min = dateISO();
  $('agendaDateFrom').value = dateISO();
  $('agendaDateTo').value = dateISO(new Date(Date.now() + 30 * 86400000));
  const startupTasks = [];
  if (hasAnyPermission(['pacientes', 'agenda', 'atendimento', 'receitas'])) startupTasks.push(loadPatients());
  if (hasPermission('agenda') || hasPermission('atendimento')) startupTasks.push(loadProcedures());
  if (hasPermission('estoque')) startupTasks.push(loadProducts());
  await Promise.all(startupTasks);
  const firstTab = ['dashboard', 'agenda', 'pacientes', 'atendimento', 'financeiro', 'estoque', 'relatorios', 'servicos', 'logs', 'usuarios']
    .find((tab) => ['usuarios', 'servicos', 'logs'].includes(tab) ? isOwner : {
      dashboard: hasPermission('dashboard'), agenda: hasPermission('agenda'), pacientes: hasPermission('pacientes'),
      atendimento: hasPermission('atendimento'), financeiro: hasAnyPermission(['receitas', 'despesas']),
      estoque: hasPermission('estoque'), relatorios: hasAnyPermission(['relatorio_estoque', 'relatorio_financeiro']),
    }[tab]);
  if (firstTab) goTo(firstTab);
}
