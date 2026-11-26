export async function api(url, options = {}) {
  const config = { credentials: 'same-origin', cache: 'no-store', ...options };
  if (config.body && typeof config.body !== 'string') {
    config.headers = { 'Content-Type': 'application/json', ...config.headers };
    config.body = JSON.stringify(config.body);
  }
  let response;
  try {
    response = await fetch(url, config);
  } catch {
    throw new Error('Não foi possível acessar o servidor. Confira se o sistema está rodando.');
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.erro || 'Não foi possível concluir a solicitação.');
    error.status = response.status;
    error.code = data.codigo;
    error.field = data.campo;
    error.sugestoes = data.sugestoes;
    throw error;
  }
  return data;
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function showSkeleton(element, label = 'Carregando informações', rows = 3) {
  if (!element) return () => {};
  element.setAttribute('aria-busy', 'true');
  element.innerHTML = '<div class="loading-skeleton" role="status"><span class="sr-only">' + escapeHtml(label) +
    '</span><div aria-hidden="true">' + '<span class="skeleton-block"></span>'.repeat(rows) + '</div></div>';
  return () => {
    element.removeAttribute('aria-busy');
    element.querySelector('.loading-skeleton')?.remove();
  };
}

export function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function dateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function formatDate(value) {
  if (!value) return '—';
  const parts = String(value).slice(0, 10).split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(value);
}

export function formatLongDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

export function formatTime(value) {
  if (!value) return '—';
  const match = String(value).match(/(\d{2}:\d{2})/);
  return match ? match[1] : String(value);
}

export function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'SG';
}

export function setMessage(element, message, success = false) {
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('success', Boolean(message && success));
  element.classList.toggle('error', Boolean(message && !success));
}

export function toast(message, success = false) {
  const element = document.getElementById('toast');
  if (!element) return;
  element.textContent = message;
  element.className = 'toast show' + (success ? ' toast-success' : '');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove('show'), 3500);
}

export function statusLabel(status) {
  const values = {
    AGENDADO: ['Aguardando confirmação', 'status-pending'],
    CONFIRMADO: ['Confirmada', 'status-confirmed'],
    CONCLUIDO: ['Realizada', 'status-done'],
    CANCELADO: ['Cancelada', 'status-cancelled'],
    FALTOU: ['Faltou', 'status-cancelled'],
    PENDENTE: ['Pendente', 'status-pending'],
    PAGO: ['Pago', 'status-done'],
    PAGA: ['Paga', 'status-done'],
    VENCIDA: ['Vencida', 'status-cancelled'],
    ATIVO: ['Ativa', 'status-done'],
    INATIVO: ['Inativa', 'status-cancelled'],
    EM_ANDAMENTO: ['Em andamento', 'status-confirmed'],
  };
  return values[String(status || '').toUpperCase()] || [String(status || '—'), 'status-neutral'];
}

export function statusBadge(status) {
  const [label, className] = statusLabel(status);
  return '<span class="status-pill ' + className + '">' + escapeHtml(label) + '</span>';
}

export function optionList(items, placeholder, getValue = (item) => item.id, getLabel = (item) => item.nome) {
  return '<option value="">' + escapeHtml(placeholder) + '</option>' + items.map((item) =>
    '<option value="' + escapeHtml(getValue(item)) + '">' + escapeHtml(getLabel(item)) + '</option>'
  ).join('');
}

export function cpfDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpf(value) {
  const cpf = cpfDigits(value);
  if (cpf.length > 9) return cpf.slice(0, 3) + '.' + cpf.slice(3, 6) + '.' + cpf.slice(6, 9) + '-' + cpf.slice(9);
  if (cpf.length > 6) return cpf.slice(0, 3) + '.' + cpf.slice(3, 6) + '.' + cpf.slice(6);
  if (cpf.length > 3) return cpf.slice(0, 3) + '.' + cpf.slice(3);
  return cpf;
}

export function dateTimeValue(appointment) {
  const date = appointment.data || String(appointment.data_hora || '').slice(0, 10);
  const time = appointment.hora || formatTime(appointment.data_hora);
  return new Date(date + 'T' + time + ':00');
}

export function canChangeAppointment(appointment) {
  return ['AGENDADO', 'CONFIRMADO'].includes(String(appointment.status).toUpperCase()) &&
    dateTimeValue(appointment).getTime() - Date.now() >= 2 * 60 * 60 * 1000;
}

export function formatAppointmentDate(appointment) {
  const date = appointment.data || String(appointment.data_hora || '').slice(0, 10);
  const time = appointment.hora || formatTime(appointment.data_hora);
  return formatLongDate(date) + ', às ' + time;
}

export function bindSubmit(form, handler) {
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    Promise.resolve(handler(event)).catch((error) => {
      const message = form.querySelector('.form-message');
      setMessage(message, error.message);
    });
  });
}
