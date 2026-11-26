import { escapeHtml, formatLongDate, formatTime, dateISO, statusBadge, canChangeAppointment } from './common.js';
import { adminIcon } from './admin-icons.js';

export function initConsultations({ getService, onReschedule, onCancel }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('portal-consultas');
  const dialog = $('consultationDetailDialog');
  let appointments = [];
  let upcoming = [];
  let past = [];
  let activeTab = 'upcoming';
  let selectedDate = '';
  let calendarMonth = new Date();
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  let calendarInitialized = false;

  const appointmentInstant = (item) => new Date(item.data + 'T' + formatTime(item.hora) + ':00-03:00').getTime();
  const serviceDuration = (item) => Number(getService(item.procedimento_id)?.duracao_media_min || item.duracao_prevista_min || 60);
  const monthName = (date) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
  const dateObject = (date) => new Date(date + 'T12:00:00');
  const dateTile = (item, featured = false) => {
    const date = dateObject(item.data);
    const month = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '');
    return '<div class="consultation-date-tile' + (featured ? ' consultation-date-featured' : '') + '" aria-hidden="true">' +
      (featured ? '<small>' + escapeHtml(month) + '</small>' : '') + '<strong>' + date.getDate() + '</strong>' +
      '<small>' + escapeHtml(featured ? new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(date) : month) + '</small></div>';
  };

  function actionButtons(item, featured = false) {
    if (!canChangeAppointment(item)) return '';
    return '<button type="button" class="button button-outline button-small" data-reschedule="' + escapeHtml(item.id) + '">' +
      (featured ? adminIcon('calendar') : '') + 'Remarcar</button><button type="button" class="text-button consultation-cancel" data-cancel="' + escapeHtml(item.id) + '">Cancelar consulta</button>';
  }

  function renderFeatured() {
    const next = upcoming[0];
    const destination = $('featuredPatientAppointment');
    if (!next) {
      destination.innerHTML = '<div class="consultations-featured-empty"><span class="consultations-featured-icon">' + adminIcon('calendar') + '</span><div><h2>Seu próximo cuidado começa aqui</h2><p>Você ainda não tem uma consulta próxima. Escolha um horário para cuidar dos seus pés.</p></div><button type="button" class="button" data-portal-go="agendar">Agendar consulta ' + adminIcon('plus') + '</button></div>';
      return;
    }
    destination.innerHTML = '<div class="consultations-featured-heading"><span>' + adminIcon('calendar') + 'Sua próxima consulta</span>' + statusBadge(next.status) + '</div>' +
      '<div class="consultations-featured-body">' + dateTile(next, true) + '<div class="consultations-featured-info"><h2>' + escapeHtml(next.procedimento_nome || 'Consulta podológica') + '</h2>' +
      '<p>' + adminIcon('clock') + escapeHtml(formatTime(next.hora) + ' · ' + serviceDuration(next) + ' minutos') + '</p><p>' + adminIcon('pin') + 'Atendimento na clínica</p></div>' +
      '<div class="consultations-featured-actions">' + actionButtons(next, true) + '<button type="button" class="text-button" data-consultation-details="' + escapeHtml(next.id) + '">Ver detalhes ' + adminIcon('chevron') + '</button></div></div>' +
      '<p class="consultations-featured-note">' + adminIcon(next.status === 'AGENDADO' ? 'clock' : 'users') +
      (next.status === 'AGENDADO' ? 'Estamos aguardando a confirmação da recepção. Acompanhe o status por aqui.' : 'Sua consulta está confirmada. Esperamos você na clínica!') + '</p>';
  }

  function renderRow(item) {
    return '<article class="consultation-row">' + dateTile(item) + '<div class="consultation-row-info"><button type="button" class="consultation-row-title" data-consultation-details="' + escapeHtml(item.id) + '">' +
      escapeHtml(item.procedimento_nome || 'Consulta podológica') + '</button><p>' + escapeHtml(formatLongDate(item.data) + ' · ' + formatTime(item.hora)) + '</p>' + statusBadge(item.status) + '</div>' +
      '<details class="consultation-row-menu"><summary aria-label="Opções da consulta de ' + escapeHtml(formatLongDate(item.data) + ' às ' + formatTime(item.hora)) + '">' + adminIcon('more') + '</summary><div>' +
      '<button type="button" class="text-button" data-consultation-details="' + escapeHtml(item.id) + '">Ver detalhes</button>' + actionButtons(item) + '</div></details></article>';
  }

  function renderLists() {
    const items = activeTab === 'upcoming' ? upcoming : past;
    const visible = selectedDate ? items.filter((item) => item.data === selectedDate) : items;
    $('consultationsCount').textContent = visible.length + (visible.length === 1 ? ' agendamento' : ' agendamentos');
    $('clearConsultationDate').hidden = !selectedDate;
    ['upcoming', 'past'].forEach((tab) => {
      const active = activeTab === tab;
      const button = $(tab === 'upcoming' ? 'upcomingConsultationsTab' : 'pastConsultationsTab');
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      const list = $(tab === 'upcoming' ? 'upcomingAppointments' : 'pastAppointments');
      list.hidden = !active;
      if (active) list.innerHTML = visible.length ? visible.map(renderRow).join('') : '<div class="consultations-empty">' + adminIcon('calendar') + '<h3>' +
        (selectedDate ? 'Nenhuma consulta nesta data' : tab === 'upcoming' ? 'Sua agenda está livre' : 'Seu histórico começa aqui') + '</h3><p>' +
        (selectedDate ? 'Escolha outra data ou veja todos os agendamentos.' : tab === 'upcoming' ? 'Suas próximas consultas aparecerão aqui assim que você agendar.' : 'As consultas anteriores e canceladas aparecerão nesta aba.') + '</p></div>';
    });
  }

  function renderCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const items = activeTab === 'upcoming' ? upcoming : past;
    const counts = new Map();
    items.forEach((item) => counts.set(item.data, (counts.get(item.data) || 0) + 1));
    const label = monthName(calendarMonth);
    $('consultationsMonthLabel').textContent = label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1);
    $('consultationsCalendarDays').setAttribute('aria-label', 'Consultas de ' + label);
    $('consultationsCalendarLegend').textContent = activeTab === 'upcoming' ? 'Consulta agendada' : 'Consulta no histórico';
    $('consultationsCalendarDays').innerHTML = '<span aria-hidden="true"></span>'.repeat(first.getDay()) + Array.from({ length: days }, (_, index) => {
      const date = dateISO(new Date(year, month, index + 1));
      const count = counts.get(date) || 0;
      const today = date === dateISO();
      return '<button type="button" class="consultations-calendar-day' + (count ? ' has-consultation' : '') + (date === selectedDate ? ' selected' : '') + '" data-consultation-date="' + date +
        '" aria-pressed="' + (date === selectedDate) + '" aria-label="' + escapeHtml(formatLongDate(date) + ', ' + count + (count === 1 ? ' consulta' : ' consultas')) + '"' +
        (today ? ' aria-current="date"' : '') + (count ? '' : ' disabled') + '>' + (index + 1) + '</button>';
    }).join('');
  }

  function switchTab(tab) {
    activeTab = tab;
    selectedDate = '';
    const first = (tab === 'upcoming' ? upcoming : past)[0];
    if (first) calendarMonth = new Date(dateObject(first.data).getFullYear(), dateObject(first.data).getMonth(), 1);
    renderLists();
    renderCalendar();
  }
  panel.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tab = event.key === 'Home' ? 'upcoming' : event.key === 'End' ? 'past' : activeTab === 'upcoming' ? 'past' : 'upcoming';
    switchTab(tab);
    $(tab === 'upcoming' ? 'upcomingConsultationsTab' : 'pastConsultationsTab').focus();
  });
  $('clearConsultationDate').addEventListener('click', () => { selectedDate = ''; renderLists(); renderCalendar(); });
  function shiftMonth(direction) {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + direction, 1);
    selectedDate = '';
    renderLists();
    renderCalendar();
  }
  $('consultationPreviousMonth').addEventListener('click', () => shiftMonth(-1));
  $('consultationNextMonth').addEventListener('click', () => shiftMonth(1));

  function openDetails(id) {
    const item = appointments.find((appointment) => String(appointment.id) === id);
    if (!item) return;
    $('consultationDetailContent').innerHTML = '<div class="consultation-detail-heading"><h3>' + escapeHtml(item.procedimento_nome || 'Consulta podológica') + '</h3>' + statusBadge(item.status) + '</div>' +
      '<dl class="consultation-detail-fields"><div><dt>Data</dt><dd>' + escapeHtml(formatLongDate(item.data)) + '</dd></div><div><dt>Horário</dt><dd>' + escapeHtml(formatTime(item.hora)) + '</dd></div>' +
      '<div><dt>Duração do serviço</dt><dd>' + serviceDuration(item) + ' minutos</dd></div><div><dt>Tempo reservado na agenda</dt><dd>' + Number(item.duracao_prevista_min || 60) + ' minutos</dd></div></dl>' +
      '<div class="consultation-detail-note"><h3>Observações</h3><p>' + escapeHtml(item.observacao || 'Nenhuma observação registrada.') + '</p></div>' +
      '<div class="consultation-detail-actions">' + actionButtons(item, true) + '</div><p class="muted">Alterações pelo portal podem ser feitas até 2 horas antes da consulta.</p>';
    dialog.showModal();
  }
  async function handleActions(event) {
    const tab = event.target.closest('[data-consultation-tab]');
    if (tab) { switchTab(tab.dataset.consultationTab); return; }
    const day = event.target.closest('[data-consultation-date]');
    if (day) {
      selectedDate = selectedDate === day.dataset.consultationDate ? '' : day.dataset.consultationDate;
      renderLists(); renderCalendar(); return;
    }
    const details = event.target.closest('[data-consultation-details]');
    if (details) { details.closest('details')?.removeAttribute('open'); openDetails(details.dataset.consultationDetails); return; }
    const reschedule = event.target.closest('[data-reschedule]');
    const cancel = event.target.closest('[data-cancel]');
    if (!reschedule && !cancel) return;
    const button = reschedule || cancel;
    button.closest('details')?.removeAttribute('open');
    if (dialog.open) dialog.close();
    button.disabled = true;
    try {
      if (reschedule) await onReschedule(reschedule.dataset.reschedule);
      else await onCancel(cancel.dataset.cancel);
    } finally { button.disabled = false; }
  }
  panel.addEventListener('click', handleActions);
  $('consultationDetailContent').addEventListener('click', handleActions);
  $('closeConsultationDetail').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  document.addEventListener('click', (event) => {
    panel.querySelectorAll('.consultation-row-menu[open]').forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    panel.querySelectorAll('.consultation-row-menu[open]').forEach((menu) => { menu.open = false; menu.querySelector('summary').focus(); });
  });

  return {
    showUpcoming() { switchTab('upcoming'); },
    render(items) {
      appointments = items;
      upcoming = items.filter((item) => ['AGENDADO', 'CONFIRMADO'].includes(item.status) && appointmentInstant(item) >= Date.now())
        .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
      past = items.filter((item) => !upcoming.includes(item)).sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));
      if (!calendarInitialized && upcoming[0]) {
        const first = dateObject(upcoming[0].data);
        calendarMonth = new Date(first.getFullYear(), first.getMonth(), 1);
        calendarInitialized = true;
      }
      if (selectedDate && !(activeTab === 'upcoming' ? upcoming : past).some((item) => item.data === selectedDate)) selectedDate = '';
      renderFeatured(); renderLists(); renderCalendar();
      return { upcoming, past };
    },
  };
}
