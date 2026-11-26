(() => {
  const config = window.sgcpConfig || {};
  document.querySelectorAll('[data-brand]').forEach((element) => {
    const value = config[element.dataset.brand];
    if (typeof value === 'string' && value) element.textContent = value;
  });
  document.querySelectorAll('[data-brand-title]').forEach((element) => {
    element.textContent = element.dataset.brandTitle + ' | ' + (config.clinicName || 'Clínica Podológica');
  });
  document.querySelectorAll('[data-contact-link]').forEach((link) => {
    if (/^\d{10,15}$/.test(config.whatsapp || '')) {
      link.href = 'https://wa.me/' + config.whatsapp;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else if (config.contactEmail) {
      link.href = 'mailto:' + encodeURIComponent(config.contactEmail);
    }
  });
  document.querySelectorAll('[data-contact-direct]').forEach((element) => {
    element.hidden = !config.whatsapp && !config.contactEmail;
  });
})();
