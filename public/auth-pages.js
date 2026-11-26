import { api, setMessage, cpfDigits, formatCpf } from './common.js';

function agendamentoSolicitado() {
  return new URLSearchParams(window.location.search).get('next') === 'agendar';
}

function destinoPortalPaciente() {
  return agendamentoSolicitado() ? '/portal.html?aba=agendar' : '/portal.html';
}

function manterDestinoAgendamento(link) {
  if (link && agendamentoSolicitado()) link.href += '?next=agendar';
}

async function goToCorrectArea() {
  try {
    const { usuario } = await api('/api/auth/me');
    window.location.replace(usuario.perfil === 'PACIENTE' ? destinoPortalPaciente() : '/interno.html');
    return true;
  } catch (error) {
    if (error.status !== 401) throw error;
    return false;
  }
}

export async function initLogin() {
  if (await goToCorrectArea()) return;
  manterDestinoAgendamento(document.querySelector('.podology-login-register a'));
  const message = document.getElementById('loginMessage');
  const setup = await api('/api/auth/setup/status');
  if (!setup.configurado) {
    const link = document.createElement('a');
    link.href = '/setup.html';
    link.className = 'setup-hint';
    link.textContent = 'Configurar a conta da podóloga';
    document.getElementById('loginForm').append(link);
  }

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage(message, 'Validando acesso…', true);
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: {
          identificador: document.getElementById('loginEmail').value.trim(),
          senha: document.getElementById('loginPassword').value,
          manterConectado: document.getElementById('keepConnected').checked,
        },
      });
      window.location.replace(result.usuario.perfil === 'PACIENTE' ? destinoPortalPaciente() : '/interno.html');
    } catch (error) {
      setMessage(message, error.message);
      button.disabled = false;
    }
  });
}

export async function initRegister() {
  if (await goToCorrectArea()) return;
  if (new URLSearchParams(window.location.search).has('convite')) {
    document.querySelector('#patientRegister .muted').textContent = 'Você recebeu um convite da clínica. Informe seu CPF, e-mail e senha para vincular o acesso ao seu cadastro. O convite vale por 24 horas e só pode ser usado uma vez.';
  }
  manterDestinoAgendamento(document.querySelector('.auth-foot a'));
  const cpfInput = document.getElementById('registerCpf');
  cpfInput.addEventListener('input', () => { cpfInput.value = formatCpf(cpfDigits(cpfInput.value)); });
  const ageGroup = document.getElementById('registerAgeGroup');
  const guardianFields = document.getElementById('registerGuardianFields');
  const guardianName = document.getElementById('registerGuardianName');
  const guardianCpf = document.getElementById('registerGuardianCpf');
  const guardianConsent = document.getElementById('registerGuardianConsent');
  const guardianRelationship = document.getElementById('registerGuardianRelationship');
  const updateGuardianFields = () => {
    const required = ageGroup.value === 'MENOR';
    guardianFields.hidden = !required;
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
  ageGroup.addEventListener('change', updateGuardianFields);
  guardianCpf.addEventListener('input', () => { guardianCpf.value = formatCpf(cpfDigits(guardianCpf.value)); });
  updateGuardianFields();
  const message = document.getElementById('registerMessage');
  document.getElementById('patientRegister').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage(message, 'Criando sua conta…', true);
    try {
      await api('/api/auth/cadastro-paciente', {
        method: 'POST',
        body: {
          cpf: cpfDigits(cpfInput.value),
          convite: new URLSearchParams(window.location.search).get('convite') || undefined,
          faixaEtaria: ageGroup.value,
          responsavelNome: guardianName.value.trim(),
          responsavelCpf: cpfDigits(guardianCpf.value),
          consentimentoResponsavel: guardianConsent.checked,
          responsavelVinculo: guardianRelationship.value,
          email: document.getElementById('registerEmail').value.trim(),
          senha: document.getElementById('registerPassword').value,
          aceitouAvisoPrivacidade: document.getElementById('privacyNoticeAccepted').checked,
          aceitouTermos: document.getElementById('termsAccepted').checked,
          versaoTermos: document.getElementById('termsAccepted').value,
        },
      });
      window.location.replace(destinoPortalPaciente());
    } catch (error) {
      setMessage(message, error.message);
      button.disabled = false;
    }
  });
}

export async function initSetup() {
  const status = await api('/api/auth/setup/status');
  if (status.configurado) {
    window.location.replace('/login.html');
    return;
  }
  const message = document.getElementById('setupMessage');
  document.getElementById('setupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage(message, 'Criando a conta proprietária…', true);
    try {
      await api('/api/auth/setup', {
        method: 'POST',
        body: {
          nome: document.getElementById('setupName').value.trim(),
          registroProfissional: document.getElementById('setupRegistration').value.trim(),
          email: document.getElementById('setupEmail').value.trim(),
          senha: document.getElementById('setupPassword').value,
        },
      });
      window.location.replace('/interno.html');
    } catch (error) {
      setMessage(message, error.message);
      button.disabled = false;
    }
  });
}
