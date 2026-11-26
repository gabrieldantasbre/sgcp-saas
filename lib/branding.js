// Somente estes dados públicos podem ser enviados ao navegador.
function publicBranding(env = process.env) {
  const text = (key, fallback, max = 120) => String(env[key] || '').trim().slice(0, max) || fallback;
  const whatsapp = String(env.CLINIC_WHATSAPP || '').replace(/\D/g, '');
  const email = String(env.CLINIC_CONTACT_EMAIL || '').trim();
  return {
    productName: text('APP_NAME', 'SGCP', 40),
    clinicName: text('CLINIC_NAME', 'Clínica Podológica'),
    professionalName: text('CLINIC_PROFESSIONAL_NAME', 'Equipe de podologia'),
    address: text('CLINIC_ADDRESS', 'Consulte a equipe para informações de atendimento.', 240),
    whatsapp: /^\d{10,15}$/.test(whatsapp) ? whatsapp : '',
    contactEmail: /^[^\s@<>"?#]+@[^\s@<>"?#]+\.[^\s@<>"?#]+$/.test(email) ? email : '',
  };
}

module.exports = { publicBranding };
