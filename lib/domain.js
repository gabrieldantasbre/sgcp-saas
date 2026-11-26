function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeClinicPhone(value) {
  const phone = digits(value);
  // Remove the Brazilian country code only when followed by a complete DDD + number.
  return /^55\d{10,11}$/.test(phone) ? phone.slice(2) : phone;
}

function cpfIsValid(value, allowInvalidForDevelopment = false) {
  const cpf = digits(value);
  if (allowInvalidForDevelopment && process.env.VALIDAR_CPF === 'false') return cpf.length === 11;
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const position of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += Number(cpf[i]) * (position + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[position])) return false;
  }
  return true;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(String(value) + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function clinicDateTime(date, time) {
  return date + ' ' + time + ':00';
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

function localClinicDateTime(date, time) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
}

module.exports = {
  digits,
  normalizeClinicPhone,
  cpfIsValid,
  isValidDate,
  clinicDateTime,
  todayInSaoPaulo,
  localClinicDateTime,
};
