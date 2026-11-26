import { api, escapeHtml, formatLongDate, formatCpf, cpfDigits, setMessage } from './common.js';

import { showSkeleton } from './common.js';

const $ = (id) => document.getElementById(id);
const paymentLabels = { PIX: 'Pix', CARTAO_CREDITO: 'Cartão de crédito', CARTAO_DEBITO: 'Cartão de débito', DINHEIRO: 'Dinheiro', BOLETO: 'Boleto', TRANSFERENCIA: 'Transferência' };
const iconPaths = {
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-14 4h2m3 0h2m3 0h1M7 18h2m3 0h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  care: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8m-4-4h8"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2L5 6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h15V8H5"/><path d="M20 12h-5v5h5m-3-2.5h.01"/>',
  card: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>',
  receipt: '<path d="M5 3l3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6m-6 4h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  check: '<path d="m6 12 4 4 8-8"/><circle cx="12" cy="12" r="10"/>',
};

export async function initPublicBooking() {
  let services = [];
  let days = [];
  let selectedDate = '';
  let selectedTime = '';
  let step = 0;
  let requestVersion = 0;
  let loading = false;
  let submitting = false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const currentMonth = today.slice(0, 7) + '-01';
  let visibleMonth = currentMonth;
  const message = $('publicBookingMessage');
  const payment = () => document.querySelector('input[name="publicPayment"]:checked');
  const monthDate = () => new Date(visibleMonth + 'T12:00:00Z');

  document.querySelectorAll('[data-booking-icon]').forEach((el) => {
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + iconPaths[el.dataset.bookingIcon] + '</svg>';
  });
  function showStep(value, focus = true) {
    step = value;
    document.querySelectorAll('[data-booking-step]').forEach((el) => { el.hidden = Number(el.dataset.bookingStep) !== step; });
    document.querySelectorAll('[data-progress]').forEach((el) => {
      const index = Number(el.dataset.progress);
      el.classList.toggle('active', index === step);
      el.classList.toggle('complete', index < step);
      const button = el.querySelector('button');
      button.disabled = index > step;
      if (index === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    setMessage(message, '');
    $('publicBookingForm').append(message);
    if (focus) document.querySelector('[data-booking-step="' + step + '"] h1, [data-booking-step="' + step + '"] h2')?.focus({ preventScroll: true });
  }
  function summary() {
    const values = {
      publicSummaryProfessional: $('publicProfessional').value ? $('publicProfessional').selectedOptions[0].textContent : '',
      publicSummaryService: services.find((s) => String(s.id) === $('publicProcedure').value)?.nome,
      publicSummaryDate: selectedDate ? formatLongDate(selectedDate) : '',
      publicSummaryTime: selectedTime,
      publicSummaryPayment: paymentLabels[payment()?.value],
    };
    Object.entries(values).forEach(([id, value]) => {
      $(id).textContent = value || 'A selecionar';
      $(id).classList.toggle('is-placeholder', !value);
    });
  }
  function validStep(value) {
    if (value === 3) {
      $('publicName').setCustomValidity($('publicName').value.trim().length < 3 ? 'Informe o nome completo do paciente.' : '');
      $('publicCpf').setCustomValidity(cpfDigits($('publicCpf').value).length !== 11 ? 'Informe os 11 dígitos do CPF do paciente.' : '');
      $('publicPhone').setCustomValidity(!/^(?:\d{10,11}|55\d{10,11})$/.test($('publicPhone').value.replace(/\D/g, '')) ? 'Informe o celular com DDD, com ou sem o código do Brasil (+55).' : '');
      const minor = !$('publicGuardianFields').hidden;
      $('publicGuardianName').setCustomValidity(minor && $('publicGuardianName').value.trim().length < 3 ? 'Informe o nome completo do responsável.' : '');
      $('publicGuardianCpf').setCustomValidity(minor && cpfDigits($('publicGuardianCpf').value).length !== 11 ? 'Informe os 11 dígitos do CPF do responsável.' : '');
    }
    const invalid = Array.from(document.querySelectorAll('[data-booking-step="' + value + '"] input, [data-booking-step="' + value + '"] select, [data-booking-step="' + value + '"] textarea')).find((input) => !input.checkValidity());
    if (!invalid) return true;
    if (step !== value) showStep(value);
    invalid.reportValidity();
    return false;
  }
  function renderCalendar() {
    const first = monthDate();
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth();
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    $('publicCalendarMonth').textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    $('publicPreviousMonth').disabled = visibleMonth <= currentMonth;
    $('publicCalendar').setAttribute('aria-busy', String(loading));
    let cells = '<span class="booking-calendar-blank" aria-hidden="true"></span>'.repeat(first.getUTCDay());
    for (let day = 1; day <= count; day++) {
      const date = visibleMonth.slice(0, 7) + '-' + String(day).padStart(2, '0');
      const available = days.find((item) => item.data === date);
      const enabled = !loading && date >= today && available?.horarios.length;
      const selected = date === selectedDate;
      const state = date < today ? ' is-past' : (!enabled && !loading ? ' is-unavailable' : '');
      const label = formatLongDate(date) + (loading ? ', consultando agenda' : enabled ? ', ' + available.horarios.length + ' horários disponíveis' : ', indisponível');
      cells += '<button type="button" class="booking-calendar-day' + state + (selected ? ' selected' : '') + '" data-public-date="' + date + '" aria-label="' + escapeHtml(label) + '" aria-pressed="' + selected + '"' + (date === today ? ' aria-current="date"' : '') + (enabled ? '' : ' disabled') + '>' + day + '</button>';
    }
    $('publicDates').innerHTML = cells;
    $('choosePublicTime').disabled = loading || !days.some((day) => day.data === selectedDate);
  }
  async function loadDates() {
    if (!validStep(0)) return;
    const version = ++requestVersion;
    showStep(1);
    loading = true;
    days = [];
    $('publicRetryDates').hidden = true;
    $('publicCalendarStatus').textContent = 'Consultando a agenda…';
    renderCalendar();
    const first = monthDate();
    const stopLoading = showSkeleton($('publicDates'), 'Carregando dias disponíveis', 2);
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
    const query = new URLSearchParams({ procedimentoId: $('publicProcedure').value, de: visibleMonth < today ? today : visibleMonth, ate: last });
    try {
      const result = await api('/api/agendamentos/disponibilidade?' + query);
      if (version !== requestVersion) return;
      days = result.dias;
      if (!days.some((day) => day.data === selectedDate && day.horarios.includes(selectedTime))) selectedTime = '';
      if (!days.some((day) => day.data === selectedDate)) selectedDate = '';
      $('publicCalendarStatus').textContent = days.length ? 'Selecione um dia disponível para ver os horários.' : 'Nenhum horário disponível neste mês. Consulte o próximo mês ou fale com a clínica.';
    } catch (error) {
      if (version !== requestVersion) return;
      selectedDate = '';
      selectedTime = '';
      $('publicCalendarStatus').textContent = 'Não foi possível consultar a agenda.';
      $('publicRetryDates').hidden = false;
      setMessage(message, error.message);
    } finally {
      if (version === requestVersion) { stopLoading(); loading = false; renderCalendar(); summary(); }
    }
  }
  function resetSelection() {
    requestVersion++;
    loading = false;
    days = [];
    selectedDate = '';
    selectedTime = '';
    visibleMonth = currentMonth;
    summary();
  }
  function renderTimes() {
    const available = days.find((day) => day.data === selectedDate);
    $('publicTimeDate').textContent = selectedDate ? formatLongDate(selectedDate) : '';
    $('publicTimes').innerHTML = (available?.horarios || []).map((time) => '<button type="button" class="time-choice' + (time === selectedTime ? ' selected' : '') + '" aria-pressed="' + (time === selectedTime) + '" data-public-time="' + escapeHtml(time) + '">' + escapeHtml(time) + '</button>').join('');
  }
  $('choosePublicDate').addEventListener('click', loadDates);
  $('publicRetryDates').addEventListener('click', loadDates);
  ['publicProcedure', 'publicProfessional'].forEach((id) => $(id).addEventListener('change', resetSelection));
  [['publicPreviousMonth', -1], ['publicNextMonth', 1]].forEach(([id, offset]) => $(id).addEventListener('click', () => {
    const next = monthDate();
    next.setUTCMonth(next.getUTCMonth() + offset);
    const month = next.toISOString().slice(0, 10);
    if (month < currentMonth) return;
    visibleMonth = month;
    selectedDate = '';
    selectedTime = '';
    summary();
    loadDates();
  }));
  $('publicDates').addEventListener('click', (event) => {
    const button = event.target.closest('[data-public-date]');
    if (!button || button.disabled || loading) return;
    selectedDate = button.dataset.publicDate;
    selectedTime = '';
    summary();
    renderCalendar();
    $('publicDates').querySelector('[data-public-date="' + selectedDate + '"]').focus({ preventScroll: true });
    const count = days.find((day) => day.data === selectedDate).horarios.length;
    $('publicCalendarStatus').textContent = count + (count === 1 ? ' horário disponível' : ' horários disponíveis') + ' em ' + formatLongDate(selectedDate) + '.';
  });
  $('choosePublicTime').addEventListener('click', () => {
    if (loading || !days.some((day) => day.data === selectedDate)) return;
    renderTimes();
    showStep(2);
  });
  $('publicTimes').addEventListener('click', (event) => {
    const button = event.target.closest('[data-public-time]');
    if (!button) return;
    selectedTime = button.dataset.publicTime;
    summary();
    renderTimes();
    showStep(3);
  });
  document.querySelectorAll('[data-booking-back], [data-booking-nav]').forEach((button) => button.addEventListener('click', () => {
    if (submitting) return;
    const target = Number(button.dataset.bookingBack ?? button.dataset.bookingNav);
    if (target <= step) showStep(target);
  }));
  ['publicCpf', 'publicGuardianCpf'].forEach((id) => $(id).addEventListener('input', () => { $(id).value = formatCpf(cpfDigits($(id).value)); }));
  $('publicBirth').max = today;
  function updateGuardian() {
    const birth = $('publicBirth').value;
    const minor = birth && Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) < 18;
    $('publicGuardianFields').hidden = !minor;
    ['publicGuardianName', 'publicGuardianCpf', 'publicGuardianConsent', 'publicGuardianRelationship'].forEach((id) => { $(id).required = Boolean(minor); });
  }
  $('publicBirth').addEventListener('change', updateGuardian);
  document.querySelector('[data-booking-step="3"]').addEventListener('input', (event) => {
    event.target.setCustomValidity?.('');
    event.target.removeAttribute('aria-invalid');
  });
  $('choosePublicPayment').addEventListener('click', () => {
    updateGuardian();
    if (validStep(3)) showStep(4);
  });
  document.querySelectorAll('input[name="publicPayment"]').forEach((input) => input.addEventListener('change', summary));
  $('publicBookingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    // Enter advances only the current step; hidden required fields are validated when shown.
    if (step === 0) { await loadDates(); return; }
    if (step === 3) { $('choosePublicPayment').click(); return; }
    if (step !== 4) return;
    updateGuardian();
    if (!validStep(0) || !validStep(3) || !validStep(4)) return;
    if (!selectedDate || !selectedTime) { await loadDates(); return; }
    submitting = true;
    $('sendPublicBooking').disabled = true;
    setMessage(message, '');
    try {
      // Keep the existing booking API; the preference accompanies the clinic's observation.
      const observation = [$('publicObservation').value.trim(), 'Preferência de pagamento: ' + paymentLabels[payment().value] + '.'].filter(Boolean).join('\n');
      await api('/api/agendamentos/publico', { method: 'POST', body: {
        procedimentoId: $('publicProcedure').value, data: selectedDate, hora: selectedTime,
        nome: $('publicName').value.trim(), cpf: cpfDigits($('publicCpf').value), telefone: $('publicPhone').value.trim(), nascimento: $('publicBirth').value, email: $('publicEmail').value.trim(), observacao: observation,
        responsavelNome: $('publicGuardianName').value.trim(), responsavelCpf: cpfDigits($('publicGuardianCpf').value), consentimentoResponsavel: $('publicGuardianConsent').checked, aceitouAvisoPrivacidade: $('publicPrivacy').checked,
        responsavelVinculo: $('publicGuardianRelationship').value,
        aceitouTermos: $('publicTerms').checked, versaoTermos: $('publicTerms').value,
      } });
      $('publicBookingForm').hidden = true;
      $('publicBookingSuccess').hidden = false;
      document.querySelectorAll('[data-booking-nav]').forEach((button) => { button.disabled = true; });
      $('publicSuccessDetails').textContent = formatLongDate(selectedDate) + ' às ' + selectedTime;
      $('publicBookingSuccess').querySelector('h2').focus({ preventScroll: true });
    } catch (error) {
      const fields = { nome: 'publicName', cpf: 'publicCpf', telefone: 'publicPhone', nascimento: 'publicBirth', email: 'publicEmail', observacao: 'publicObservation', aceitouAvisoPrivacidade: 'publicPrivacy', aceitouTermos: 'publicTerms' };
      // A patient mismatch is also HTTP 409; only an unavailable slot clears the time.
      const unavailable = error.code === 'HORARIO_INDISPONIVEL' || (!error.code && error.status === 409 && /horário.*(indisponível|ocupado)/i.test(error.message));
      let focusField;
      if (unavailable || ['data', 'hora'].includes(error.field)) {
        selectedTime = '';
        summary();
        await loadDates();
      } else if (error.field === 'procedimentoId' || error.code === 'SERVICO_INDISPONIVEL') {
        resetSelection();
        showStep(0);
        focusField = $('publicProcedure');
      } else if (fields[error.field] || ['DADOS_PACIENTE_DIVERGENTES', 'DADOS_PACIENTE_INVALIDOS', 'DADOS_RESPONSAVEL_INVALIDOS'].includes(error.code) || (!error.code && (error.status === 400 || (error.status === 409 && error.message.includes('vincular os dados'))))) {
        showStep(3);
        focusField = $(fields[error.field] || (error.code === 'DADOS_RESPONSAVEL_INVALIDOS' ? 'publicGuardianName' : 'publicName'));
      }
      setMessage(message, error.message);
      document.querySelector('[data-booking-step="' + step + '"]').prepend(message);
      if (focusField) {
        if (error.field) focusField.setAttribute('aria-invalid', 'true');
        focusField.focus({ preventScroll: true });
      }
      message.scrollIntoView({ block: 'nearest' });
    } finally { submitting = false; $('sendPublicBooking').disabled = false; }
  });
  showStep(0, false);
  summary();
  try {
    services = await api('/api/catalogo');
    $('publicProcedure').innerHTML = '<option value="">Selecione o serviço</option>' + services.map((s) => '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.nome) + '</option>').join('');
  } catch (error) { setMessage(message, error.message); }
}
