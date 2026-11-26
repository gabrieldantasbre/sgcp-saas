import {
  api, escapeHtml, money, dateISO, formatDate, formatLongDate, formatTime,
  initials, setMessage, toast, statusBadge, formatCpf, cpfDigits,
} from './common.js';
import { adminIcon } from './admin-icons.js';
import { showSkeleton } from './common.js';
import { initConsultations } from './portal-consultations.js';

function menorPelaData(nascimento) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nascimento || '')) return false;
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [ano, mes, dia] = nascimento.split('-').map(Number);
  const [anoAtual, mesAtual, diaAtual] = hoje.split('-').map(Number);
  return anoAtual - ano - (mesAtual < mes || (mesAtual === mes && diaAtual < dia) ? 1 : 0) < 18;
}

export async function initPortal() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch {
    window.location.replace('/login.html');
    return;
  }
  if (me.usuario.perfil !== 'PACIENTE') {
    window.location.replace('/interno.html');
    return;
  }

  let services = [];
  let appointments = [];
  let selectedProcedure = null;
  let selectedDate = '';
  let selectedTime = '';
  let rescheduleId = null;
  let weekOffset = 0;
  let availableDays = [];
  let availabilityRequest = 0;
  let availabilityLoading = false;
  let bookingBusy = false;
  let appointmentsRequest = 0;
  const consultations = initConsultations({
    getService: (id) => services.find((service) => String(service.id) === String(id)),
    onReschedule: startReschedule,
    onCancel: cancelAppointment,
  });
  document.querySelectorAll('[data-portal-icon]').forEach((element) => { element.innerHTML = adminIcon(element.dataset.portalIcon); });
  document.getElementById('portalLogout').innerHTML = adminIcon('logout');

  const patient = me.paciente;
  const welcome = patient.nome.split(/\s+/)[0];
  document.getElementById('welcomeName').textContent = welcome;
  document.getElementById('portalUserName').textContent = patient.nome;
  document.getElementById('portalInitials').textContent = initials(patient.nome);

  const patientRecordDialog = document.getElementById('patientRecordDialog');
  const patientRecordContent = document.getElementById('patientRecordContent');
  let patientRecordLoaded = false;

  function recordField(label, value) {
    return '<div class="patient-record-field"><small>' + escapeHtml(label) + '</small><strong>' +
      escapeHtml(value || 'Não informado') + '</strong></div>';
  }

  function renderPatientRecord(record) {
    const personal = record.cadastro;
    const consultationCards = record.consultas.length ? record.consultas.map((item) =>
      '<article class="patient-record-item"><strong>' + escapeHtml(formatLongDate(item.data) + ' às ' + formatTime(item.hora)) +
      '</strong>' + statusBadge(item.status) + '<p>' + escapeHtml(item.procedimento_nome || 'Consulta podológica') +
      ' · ' + escapeHtml(item.tipo === 'RETORNO' ? 'Retorno' : 'Consulta') +
      (item.origem === 'ONLINE' ? ' · Agendamento pelo site' : '') + '</p>' +
      (item.observacao ? '<p>' + escapeHtml(item.observacao) + '</p>' : '') + '</article>'
    ).join('') : '<p class="empty">Você ainda não tem consultas registradas.</p>';
    const healthCards = record.saude.length ? record.saude.map((item) =>
      '<article class="patient-record-item"><strong>Ficha de saúde · ' + escapeHtml(formatLongDate(item.data_preenchimento)) + '</strong>' +
      '<p><b>Queixa:</b> ' + escapeHtml(item.queixa_principal || 'Não informada') + '</p>' +
      '<p><b>Condições:</b> ' + escapeHtml([
        item.diabetico && 'Diabetes', item.hipertenso && 'Hipertensão', item.problema_circulatorio && 'Problema circulatório',
      ].filter(Boolean).join(', ') || 'Nenhuma condição sinalizada') + '</p>' +
      recordField('Alergias', item.alergias) + recordField('Medicamentos em uso', item.medicamentos_em_uso) +
      recordField('Cirurgias anteriores', item.cirurgias_anteriores) + recordField('Tipo de calçado', item.tipo_calcado) +
      recordField('Observações', item.observacoes) + '</article>'
    ).join('') : '<p class="empty">Não há ficha de saúde preenchida.</p>';
    const treatmentCards = record.atendimentos.length ? record.atendimentos.map((item) =>
      '<article class="patient-record-item"><strong>' + escapeHtml(formatLongDate(item.data) + ' às ' + formatTime(item.hora)) +
      '</strong>' + statusBadge(item.status) + '<p>' + escapeHtml(item.procedimentos || 'Atendimento podológico') +
      (item.valor_final != null ? ' · ' + escapeHtml(money(item.valor_final)) : '') + '</p>' +
      (item.queixa ? '<p><b>Queixa:</b> ' + escapeHtml(item.queixa) + '</p>' : '') +
      (item.evolucao ? '<p><b>Evolução:</b> ' + escapeHtml(item.evolucao) + '</p>' : '') +
      (item.orientacoes ? '<p><b>Orientações:</b> ' + escapeHtml(item.orientacoes) + '</p>' : '') + '</article>'
    ).join('') : '<p class="empty">Não há atendimentos concluídos registrados.</p>';
    const paymentCards = record.pagamentos.length ? record.pagamentos.map((item) =>
      '<article class="patient-record-item"><strong>' + escapeHtml(item.descricao || item.categoria || 'Pagamento') +
      '</strong>' + statusBadge(item.status) + '<p>' + escapeHtml(money(item.valor)) + ' · ' +
      escapeHtml(item.status === 'PAGO' ? 'Pago em ' + formatLongDate(item.data_pagamento) : 'Lançado em ' + formatLongDate(item.data)) +
      (item.forma_pagamento ? ' · ' + escapeHtml(item.forma_pagamento.replaceAll('_', ' ').toLowerCase()) : '') + '</p></article>'
    ).join('') : '<p class="empty">Não há pagamentos vinculados ao cadastro.</p>';

    patientRecordContent.innerHTML =
      '<section class="patient-record-section"><h3>Dados pessoais</h3><div class="patient-record-grid">' +
      recordField('Nome completo', personal.nome) + recordField('CPF', formatCpf(personal.cpf)) +
      recordField('Data de nascimento', personal.data_nascimento ? formatLongDate(personal.data_nascimento) : '') +
      recordField('Celular', personal.telefone) + recordField('E-mail', personal.email) +
      recordField('Endereço', personal.endereco) + recordField('Cliente desde', formatLongDate(personal.data_cadastro)) +
      '</div></section>' +
      '<section class="patient-record-section"><h3>Consultas</h3>' + consultationCards + '</section>' +
      '<section class="patient-record-section"><h3>Informações de saúde</h3>' + healthCards + '</section>' +
      '<section class="patient-record-section"><h3>Histórico de atendimentos</h3>' + treatmentCards + '</section>' +
      '<section class="patient-record-section"><h3>Pagamentos</h3>' + paymentCards + '</section>';
  }

  document.getElementById('openPatientRecord').addEventListener('click', async () => {
    patientRecordDialog.showModal();
    if (patientRecordLoaded) return;
    const stopLoading = showSkeleton(patientRecordContent, 'Carregando sua ficha');
    try {
      const record = await api('/api/portal/ficha');
      renderPatientRecord(record);
      patientRecordLoaded = true;
    } catch (error) {
      patientRecordContent.innerHTML = '<p class="form-message error" role="alert">' + escapeHtml(error.message) + '</p>';
    } finally { stopLoading(); }
  });
  document.getElementById('closePatientRecord').addEventListener('click', () => patientRecordDialog.close());
  patientRecordDialog.addEventListener('click', (event) => {
    if (event.target === patientRecordDialog) patientRecordDialog.close();
  });

  const nav = document.getElementById('portalNav');
  const panels = [...document.querySelectorAll('.portal-panel')];
  function showTab(name, loadContent = true) {
    panels.forEach((panel) => {
      const active = panel.id === 'portal-' + name;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    nav.querySelectorAll('[data-portal-tab]').forEach((button) => {
      const active = button.dataset.portalTab === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (loadContent && name === 'agendar' && !patient.cadastro_completo) {
      showTab('perfil', false);
      document.getElementById('profileName').focus();
      return;
    }
    const heading = document.querySelector('#portal-' + name + ' h1');
    if (heading && loadContent) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    if (loadContent && name === 'agendar') loadServices();
    if (loadContent && name === 'consultas') loadAppointments();
  }
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-portal-tab]');
    if (button) showTab(button.dataset.portalTab);
  });
  document.querySelector('.portal-main').addEventListener('click', (event) => {
    const button = event.target.closest('[data-portal-go]');
    if (button) showTab(button.dataset.portalGo);
  });

  function renderServices() {
    const list = document.getElementById('portalServices');
    if (!services.length) {
      list.innerHTML = '<p class="empty">A clínica ainda não cadastrou serviços ativos.</p>';
      return;
    }
    list.innerHTML = services.map((service) =>
      '<button class="portal-service-choice' + (selectedProcedure && selectedProcedure.id === service.id ? ' selected' : '') +
      '" type="button" aria-pressed="' + Boolean(selectedProcedure && selectedProcedure.id === service.id) + '" data-service-id="' + escapeHtml(service.id) + '">' +
      '<span class="portal-service-icon" aria-hidden="true">' + adminIcon('treatment') + '</span><span class="portal-service-details"><strong>' +
      escapeHtml(service.nome) + '</strong><small>' + Number(service.duracao_media_min) + ' min' +
      (Number(service.valor_referencia) === 0 ? ' · avaliação gratuita' : '') + '</small></span><span class="portal-service-price">' +
      (Number(service.valor_referencia) === 0 ? 'Gratuito' : money(service.valor_referencia)) + '</span><span class="service-radio" aria-hidden="true">✓</span></button>'
    ).join('');
    list.querySelectorAll('[data-service-id]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedProcedure = services.find((item) => String(item.id) === button.dataset.serviceId);
        selectedDate = '';
        selectedTime = '';
        weekOffset = 0;
        renderServices();
        updateSummary();
        loadAvailability();
      });
    });
  }

  function updateSummary() {
    const title = document.getElementById('bookingSummaryService');
    const duration = document.getElementById('bookingSummaryDuration');
    title.textContent = selectedProcedure ? selectedProcedure.nome : 'Escolha um serviço';
    duration.textContent = selectedProcedure
      ? Number(selectedProcedure.duracao_media_min) + ' min · ' +
        (Number(selectedProcedure.valor_referencia) === 0 ? 'avaliação gratuita' : money(selectedProcedure.valor_referencia))
      : '';
    document.getElementById('bookingSummarySlot').textContent = selectedDate
      ? new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(selectedDate + 'T12:00:00')) : 'Dia não selecionado';
    document.getElementById('bookingSummaryTime').textContent = selectedTime
      ? selectedTime + ' – ' + String(Number(selectedTime.slice(0, 2)) + 1).padStart(2, '0') + ':00' : 'Escolha um horário';
    document.getElementById('bookingSummaryTotal').textContent = selectedProcedure
      ? Number(selectedProcedure.valor_referencia) === 0 ? 'Gratuito' : money(selectedProcedure.valor_referencia) : '—';
    const button = document.getElementById('confirmBooking');
    button.disabled = bookingBusy || availabilityLoading || !(selectedProcedure && selectedDate && selectedTime);
    button.textContent = rescheduleId ? 'Confirmar remarcação' : 'Confirmar agendamento';
    document.getElementById('stopReschedule').hidden = !rescheduleId;
  }

  function renderAvailability(days) {
    const dateContainer = document.getElementById('availableDates');
    const timeContainer = document.getElementById('availableTimes');
    const first = new Date(dateISO() + 'T12:00:00');
    first.setDate(first.getDate() + weekOffset * 7);
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(first);
      date.setDate(date.getDate() + index);
      return dateISO(date);
    }).filter((date) => new Date(date + 'T12:00:00').getDay() !== 0);
    const range = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(first);
    document.getElementById('portalDateRange').textContent = range.charAt(0).toLocaleUpperCase('pt-BR') + range.slice(1) + ' · ' + formatDate(dates[0]).slice(0, 5) + ' a ' + formatDate(dates.at(-1)).slice(0, 5);
    dateContainer.innerHTML = dates.map((data) => {
      const day = days.find((item) => item.data === data) || { data, horarios: [] };
      const [year, month, date] = day.data.split('-').map(Number);
      const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(new Date(year, month - 1, date));
      const monthText = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(year, month - 1, date));
      return '<button class="date-choice' + (selectedDate === day.data ? ' selected' : '') + '" type="button" aria-pressed="' + (selectedDate === day.data) + '" aria-label="' + escapeHtml(formatLongDate(day.data) + (day.horarios.length ? ', horários disponíveis' : ', sem horários disponíveis')) + '"' + (day.horarios.length ? '' : ' disabled') + ' data-date="' + day.data + '">' +
        '<small>' + escapeHtml(weekday.replace('.', '')) + '</small><strong>' + date + '</strong><small>' + escapeHtml(monthText.replace('.', '')) + '</small></button>';
    }).join('');
    dateContainer.querySelectorAll('[data-date]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedDate = button.dataset.date;
        const chosen = days.find((day) => day.data === selectedDate);
        selectedTime = '';
        renderAvailability(days);
        renderTimes(chosen.horarios);
        updateSummary();
      });
    });
    if (!selectedDate) timeContainer.innerHTML = '<p class="muted">' + (days.length ? 'Escolha um dia para ver os horários.' : 'Sem horários nesta semana. Avance para a próxima ou fale com a clínica.') + '</p>';
    if (selectedDate) {
      const chosen = days.find((day) => day.data === selectedDate);
      if (chosen) renderTimes(chosen.horarios);
    }
  }

  function renderTimes(times) {
    const destination = document.getElementById('availableTimes');
    if (!times || !times.length) {
      destination.innerHTML = '<p class="muted">Selecione outro dia.</p>';
      return;
    }
    destination.innerHTML = [['Manhã', times.filter((time) => time < '12:00')], ['Tarde', times.filter((time) => time >= '12:00')]].filter(([, slots]) => slots.length).map(([label, slots]) =>
      '<section class="portal-time-period" aria-label="Horários da ' + label.toLocaleLowerCase('pt-BR') + '"><h3>' + label + '</h3><div>' + slots.map((time) =>
        '<button class="time-choice' + (selectedTime === time ? ' selected' : '') + '" type="button" aria-pressed="' + (selectedTime === time) + '" data-time="' + time + '">' + time + '<span aria-hidden="true">✓</span></button>'
      ).join('') + '</div></section>'
    ).join('');
    destination.querySelectorAll('[data-time]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedTime = button.dataset.time;
        destination.querySelectorAll('[data-time]').forEach((item) => {
          item.classList.toggle('selected', item === button);
          item.setAttribute('aria-pressed', String(item === button));
        });
        updateSummary();
      });
    });
  }

  async function loadAvailability() {
    const request = ++availabilityRequest;
    const dates = document.getElementById('availableDates');
    const times = document.getElementById('availableTimes');
    if (!selectedProcedure) {
      dates.innerHTML = '<p class="muted">Escolha primeiro um serviço.</p>';
      times.innerHTML = '<p class="muted">Escolha um dia para ver os horários.</p>';
      document.getElementById('portalPreviousWeek').disabled = true;
      document.getElementById('portalNextWeek').disabled = true;
      return;
    }
    const stopLoading = showSkeleton(dates, 'Consultando a agenda', 2);
    times.innerHTML = '';
    availabilityLoading = true;
    updateSummary();
    document.getElementById('portalPreviousWeek').disabled = true;
    document.getElementById('portalNextWeek').disabled = true;
    try {
      const first = new Date(dateISO() + 'T12:00:00');
      first.setDate(first.getDate() + weekOffset * 7);
      const last = new Date(first);
      last.setDate(last.getDate() + 6);
      const de = dateISO(first);
      const ate = dateISO(last);
      const result = await api('/api/agendamentos/disponibilidade?procedimentoId=' +
        encodeURIComponent(selectedProcedure.id) + '&de=' + de + '&ate=' + ate);
      if (request !== availabilityRequest) return;
      availableDays = result.dias;
      const chosen = availableDays.find((day) => day.data === selectedDate);
      if (!chosen || !chosen.horarios.includes(selectedTime)) selectedTime = '';
      if (!chosen) selectedDate = '';
      renderAvailability(availableDays);
    } catch (error) {
      if (request !== availabilityRequest) return;
      selectedTime = '';
      dates.innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>';
    } finally {
      if (request === availabilityRequest) {
        stopLoading();
        availabilityLoading = false;
        document.getElementById('portalPreviousWeek').disabled = weekOffset === 0;
        document.getElementById('portalNextWeek').disabled = false;
        updateSummary();
      }
    }
  }

  function changeWeek(direction) {
    weekOffset = Math.max(0, weekOffset + direction);
    selectedDate = '';
    selectedTime = '';
    loadAvailability();
  }
  document.getElementById('portalPreviousWeek').addEventListener('click', () => changeWeek(-1));
  document.getElementById('portalNextWeek').addEventListener('click', () => changeWeek(1));

  async function loadServices() {
    const stopLoading = showSkeleton(document.getElementById('portalServices'), 'Carregando serviços');
    try {
      services = await api('/api/procedimentos');
      if (selectedProcedure) selectedProcedure = services.find((service) => String(service.id) === String(selectedProcedure.id)) || null;
      if (!selectedProcedure && services.length && !rescheduleId) selectedProcedure = services[0];
      renderServices();
      updateSummary();
      await loadAvailability();
    } catch (error) {
      document.getElementById('portalServices').innerHTML = '<p class="form-message error">' + escapeHtml(error.message) + '</p>';
      selectedTime = '';
      updateSummary();
    } finally { stopLoading(); }
  }

  async function loadAppointments() {
    const request = ++appointmentsRequest;
    const stopLoading = showSkeleton(document.getElementById('nextPatientAppointment'), 'Carregando sua próxima consulta', 2);
    const stopFeatured = !appointments.length ? showSkeleton(document.getElementById('featuredPatientAppointment'), 'Carregando consultas', 2) : () => {};
    const feedback = document.getElementById('consultationsFeedback');
    setMessage(feedback, 'Atualizando suas consultas…', true);
    document.getElementById('portal-consultas').setAttribute('aria-busy', 'true');
    try {
      const result = await api('/api/agendamentos');
      if (request !== appointmentsRequest) return;
      appointments = result;
      const { upcoming } = consultations.render(appointments);
      const next = upcoming[0];
      document.getElementById('nextPatientAppointment').innerHTML = next
        ? '<div class="next-appointment"><span class="service-icon">▦</span><div><strong>' + escapeHtml(next.procedimento_nome || 'Consulta podológica') +
          '</strong><p>' + escapeHtml(formatLongDate(next.data)) + ', às ' + escapeHtml(formatTime(next.hora)) + '</p>' + statusBadge(next.status) +
          '</div><button class="button button-outline button-small" type="button" data-portal-go="consultas">Detalhes</button></div>'
        : '<div class="empty">Você ainda não tem uma consulta próxima. <button class="text-button" type="button" data-portal-go="agendar">Agendar agora →</button></div>';
      setMessage(feedback, '');
    } catch (error) {
      if (request !== appointmentsRequest) return;
      setMessage(feedback, error.message + ' Entre novamente na aba Consultas para tentar de novo.');
      if (!appointments.length) consultations.render([]);
    } finally {
      if (request === appointmentsRequest) {
        stopLoading(); stopFeatured();
        document.getElementById('portal-consultas').setAttribute('aria-busy', 'false');
      }
    }
  }

  async function cancelAppointment(id) {
    if (!window.confirm('Cancelar esta consulta?')) return;
    try {
      await api('/api/agendamentos/' + encodeURIComponent(id) + '/cancelar', { method: 'PATCH', body: {} });
      toast('Consulta cancelada.', true);
      await loadAppointments();
    } catch (error) {
      toast(error.message);
    }
  }

  async function startReschedule(id) {
    const item = appointments.find((appointment) => String(appointment.id) === String(id));
    if (!item) return;
    rescheduleId = String(item.id);
    selectedProcedure = services.find((service) => String(service.id) === String(item.procedimento_id)) || null;
    selectedDate = '';
    selectedTime = '';
    document.getElementById('bookingObservation').value = item.observacao || '';
    document.querySelector('.booking-note').open = Boolean(item.observacao);
    weekOffset = 0;
    renderServices();
    updateSummary();
    showTab('agendar', false);
    await loadAvailability();
  }

  document.getElementById('confirmBooking').addEventListener('click', async () => {
    if (!patient.cadastro_completo) { showTab('perfil'); document.getElementById('profileName').focus(); return; }
    if (bookingBusy || availabilityLoading || !selectedProcedure || !selectedDate || !selectedTime) return;
    const button = document.getElementById('confirmBooking');
    const message = document.getElementById('bookingMessage');
    button.disabled = true;
    bookingBusy = true;
    setMessage(message, rescheduleId ? 'Salvando a nova data…' : 'Enviando solicitação…', true);
    try {
      const data = {
        procedimentoId: String(selectedProcedure.id),
        data: selectedDate,
        hora: selectedTime,
        observacao: document.getElementById('bookingObservation').value.trim(),
      };
      if (rescheduleId) {
        await api('/api/agendamentos/' + encodeURIComponent(rescheduleId) + '/remarcar', { method: 'PATCH', body: data });
      } else {
        await api('/api/agendamentos', { method: 'POST', body: data });
      }
      toast(rescheduleId ? 'Consulta remarcada; a recepção confirmará o novo horário.' : 'Solicitação enviada para confirmação.', true);
      rescheduleId = null;
      selectedDate = '';
      selectedTime = '';
      document.getElementById('bookingObservation').value = '';
      document.querySelector('.booking-note').open = false;
      showTab('consultas', false);
      await loadAppointments();
      consultations.showUpcoming();
      document.getElementById('bookingMessage').textContent = '';
    } catch (error) {
      setMessage(message, error.message);
      if (error.status === 409 || error.sugestoes) await loadAvailability();
    } finally {
      bookingBusy = false;
      updateSummary();
    }
  });

  document.getElementById('stopReschedule').addEventListener('click', () => {
    rescheduleId = null;
    selectedProcedure = null;
    selectedDate = '';
    selectedTime = '';
    weekOffset = 0;
    document.getElementById('bookingObservation').value = '';
    updateSummary();
    loadServices();
    setMessage(document.getElementById('bookingMessage'), '');
  });

  document.getElementById('portalLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } finally { window.location.replace('/'); }
  });

  document.getElementById('profileCompletionNote').hidden = Boolean(patient.cadastro_completo);
  document.getElementById('profileName').value = patient.cadastro_completo ? patient.nome || '' : '';
  document.getElementById('profileCpf').value = patient.cpf || '';
  document.getElementById('profilePhone').value = patient.telefone || '';
  document.getElementById('profileBirth').value = patient.data_nascimento || '';
  document.getElementById('profileBirth').readOnly = Boolean(patient.data_nascimento);
  document.getElementById('profileEmail').value = patient.email || me.usuario.email || '';
  document.getElementById('profileAddress').value = patient.endereco || '';
  const profileBirth = document.getElementById('profileBirth');
  const guardianSection = document.getElementById('profileGuardianFields');
  const guardianName = document.getElementById('profileGuardianName');
  const guardianCpf = document.getElementById('profileGuardianCpf');
  const guardianConsent = document.getElementById('profileGuardianConsent');
  const guardianRelationship = document.getElementById('profileGuardianRelationship');
  const updateGuardianFields = () => {
    const required = patient.menor_declarado === true || menorPelaData(profileBirth.value);
    guardianSection.hidden = !required;
    guardianName.required = required;
    guardianCpf.required = required;
    guardianConsent.required = required;
    guardianRelationship.required = required;
    if (!required) {
      guardianName.value = '';
      guardianCpf.value = '';
      guardianConsent.checked = false;
      guardianRelationship.value = '';
    }
  };
  profileBirth.addEventListener('change', updateGuardianFields);
  guardianCpf.addEventListener('input', () => { guardianCpf.value = formatCpf(cpfDigits(guardianCpf.value)); });
  updateGuardianFields();
  document.getElementById('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const message = document.getElementById('profileMessage');
    button.disabled = true;
    try {
      const result = await api('/api/auth/perfil', {
        method: 'PUT',
        body: {
          nome: document.getElementById('profileName').value.trim(),
          email: document.getElementById('profileEmail').value.trim(),
          telefone: document.getElementById('profilePhone').value.trim(),
          nascimento: document.getElementById('profileBirth').value || null,
          responsavelNome: guardianName.value.trim(),
          responsavelCpf: cpfDigits(guardianCpf.value),
          consentimentoResponsavel: guardianConsent.checked,
          responsavelVinculo: guardianRelationship.value,
          endereco: document.getElementById('profileAddress').value.trim(),
        },
      });
      document.getElementById('portalUserName').textContent = result.usuario.nome;
      document.getElementById('welcomeName').textContent = result.usuario.nome.split(/\s+/)[0];
      patient.cadastro_completo = true;
      patient.nome = result.usuario.nome;
      document.getElementById('profileCompletionNote').hidden = true;
      setMessage(message, 'Dados atualizados.', true);
    } catch (error) {
      setMessage(message, error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('closePortalAccount').addEventListener('click', async (event) => {
    if (!window.confirm('Descadastrar sua conta do portal? Você perderá o acesso a esta conta. O histórico clínico não será apagado por esta ação.')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/auth/descadastro', { method: 'POST', body: {} });
      window.alert('Seu acesso ao portal foi encerrado.');
      window.location.replace('/');
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
    }
  });

  await loadServices();
  await loadAppointments();
  const requestedTab = new URLSearchParams(window.location.search).get('aba');
  if (requestedTab === 'agendar' && !patient.cadastro_completo) showTab('perfil', false);
  else if (['inicio', 'agendar', 'consultas', 'perfil'].includes(requestedTab)) showTab(requestedTab, false);
}
