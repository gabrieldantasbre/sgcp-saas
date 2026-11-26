import { api, escapeHtml, formatLongDate, formatTime, money, statusBadge, toast } from './common.js';

export function initAgendaUI({ hasPermission, onStatus, onCare }) {
  const $ = (id) => document.getElementById(id);
  const toggle = $('notificationToggle');
  const panel = $('notificationPanel');
  const dialog = $('appointmentDetailDialog');
  const content = $('appointmentDetailContent');
  let activeId = null;
  let detailRequest = 0;
  let notificationRequest = 0;

  function closeNotifications(restoreFocus = false) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }

  async function refreshNotifications() {
    if (!hasPermission('agenda')) return;
    const request = ++notificationRequest;
    $('refreshNotifications').disabled = true;
    try {
      const result = await api('/api/agendamentos/pendencias');
      if (request !== notificationRequest) return;
      $('notificationDot').hidden = !result.total;
      toggle.setAttribute('aria-label', 'Notificações da agenda: ' + result.total + ' pendentes');
      $('notificationCount').textContent = result.total
        ? result.total + (result.total === 1 ? ' consulta aguardando confirmação' : ' consultas aguardando confirmação')
        : 'Nenhuma solicitação pendente';
      $('notificationList').innerHTML = result.consultas.length ? result.consultas.map((item) =>
        '<button type="button" class="notification-item" data-notification-id="' + escapeHtml(item.id) + '">' +
        '<span class="notification-item-icon" aria-hidden="true">' + (item.origem === 'ONLINE' ? '↗' : '▦') + '</span><span><strong>' +
        escapeHtml(item.paciente_nome) + '</strong><span>' + escapeHtml(item.procedimento_nome || 'Consulta podológica') +
        '</span><small>' + escapeHtml(formatLongDate(item.data) + ' às ' + formatTime(item.hora)) + '</small></span><span aria-hidden="true">›</span></button>'
      ).join('') + (result.total > result.consultas.length ? '<p class="small-note">Exibindo as próximas 50 solicitações.</p>' : '')
        : '<div class="notification-empty"><strong>Tudo em dia</strong><p>Novas solicitações de consulta aparecerão aqui.</p></div>';
    } catch (error) {
      if (request !== notificationRequest) return;
      $('notificationCount').textContent = 'Não foi possível consultar as pendências';
      $('notificationList').innerHTML = '<p class="form-message error" role="alert">' + escapeHtml(error.message) + '</p>';
    } finally {
      if (request === notificationRequest) $('refreshNotifications').disabled = false;
    }
  }

  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) {
      $('notificationList').innerHTML = '<p class="muted">Carregando solicitações…</p>';
      refreshNotifications();
    }
  });
  $('refreshNotifications').addEventListener('click', refreshNotifications);
  document.addEventListener('click', (event) => {
    if (!panel.hidden && !event.target.closest('.notifications-container')) closeNotifications();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closeNotifications(true);
  });
  $('notificationList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-notification-id]');
    if (button) {
      closeNotifications();
      toggle.focus();
      openAppointment(button.dataset.notificationId);
    }
  });

  const field = (label, value) => '<div class="appointment-detail-field"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value || 'Não informado') + '</dd></div>';
  async function openAppointment(id) {
    activeId = String(id);
    const request = ++detailRequest;
    if (!dialog.open) dialog.showModal();
    content.innerHTML = '<p class="muted">Carregando consulta…</p>';
    try {
      const item = await api('/api/agendamentos/' + encodeURIComponent(id));
      if (request !== detailRequest || !dialog.open) return;
      const active = ['AGENDADO', 'CONFIRMADO'].includes(item.status);
      content.innerHTML = '<div class="appointment-detail-intro"><h3>' + escapeHtml(item.paciente_nome) + '</h3>' + statusBadge(item.status) + '</div>' +
        '<dl class="appointment-detail-grid">' + field('Serviço', item.procedimento_nome || 'Consulta podológica') +
        field('Data', formatLongDate(item.data)) + field('Horário', formatTime(item.hora)) +
        field('Tempo reservado', item.duracao_prevista_min + ' minutos') + field('Telefone', item.paciente_telefone) +
        field('Tipo', item.tipo === 'RETORNO' ? 'Retorno' : 'Consulta') +
        field('Origem', ({ ONLINE: 'Portal / site', PRESENCIAL: 'Presencial', WHATSAPP: 'WhatsApp' })[item.origem] || item.origem) +
        field('Valor de referência', item.valor_referencia == null ? 'Não informado' : Number(item.valor_referencia) === 0 ? 'Gratuito' : money(item.valor_referencia)) +
        field('Encaixe de urgência', item.encaixe_urgencia ? 'Sim' : 'Não') + '</dl>' +
        '<div class="appointment-detail-observation"><h3>Observações</h3><p>' + escapeHtml(item.observacao || 'Nenhuma observação registrada.') + '</p></div>' +
        '<div class="appointment-detail-actions">' +
        (item.status === 'AGENDADO' ? '<button type="button" class="button button-primary" data-detail-status="CONFIRMADO">Confirmar consulta</button>' : '') +
        (active && hasPermission('atendimento') ? '<button type="button" class="button button-outline" data-detail-care>Atender paciente</button>' : '') +
        (active ? '<button type="button" class="button button-outline" data-detail-status="CANCELADO">Cancelar consulta</button>' : '') + '</div>';
    } catch (error) {
      if (request === detailRequest && dialog.open) content.innerHTML = '<p class="form-message error" role="alert">' + escapeHtml(error.message) + '</p><button type="button" class="button button-outline" data-detail-retry>Tentar novamente</button>';
    }
  }
  content.addEventListener('click', async (event) => {
    if (event.target.closest('[data-detail-retry]')) return openAppointment(activeId);
    if (event.target.closest('[data-detail-care]')) {
      dialog.close();
      try { await onCare(activeId); }
      catch (error) { toast(error.message); }
      return;
    }
    const button = event.target.closest('[data-detail-status]');
    if (!button) return;
    const id = activeId;
    content.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    try {
      const changed = await onStatus(id, button.dataset.detailStatus);
      if (changed) await refreshNotifications();
      if (dialog.open && activeId === id) await openAppointment(id);
    } catch (error) {
      toast(error.message);
      content.querySelectorAll('button').forEach((item) => { item.disabled = false; });
    }
  });
  $('closeAppointmentDetail').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { detailRequest += 1; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotifications(); });
  // Update the badge independently of dashboard permissions.
  const timer = window.setInterval(() => { if (!document.hidden) refreshNotifications(); }, 60000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  refreshNotifications();
  return { openAppointment, refreshNotifications };
}
