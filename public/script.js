const page = document.body.dataset.page;

const initializers = {
  site: () => import('./site.js').then((module) => module.initSite()),
  login: () => import('./auth-pages.js').then((module) => module.initLogin()),
  cadastro: () => import('./auth-pages.js').then((module) => module.initRegister()),
  setup: () => import('./auth-pages.js').then((module) => module.initSetup()),
  interno: () => import('./internal.js').then((module) => module.initInternal()),
  portal: () => import('./portal.js').then((module) => module.initPortal()),
  agendamento: () => import('./booking.js').then((module) => module.initPublicBooking()),
};

if (initializers[page]) {
  initializers[page]().catch((error) => {
    console.error('Falha ao iniciar a página do SGCP:', error);
    const message = document.createElement('p');
    message.className = 'form-message error';
    message.setAttribute('role', 'alert');
    message.textContent = 'Não foi possível carregar esta página. Atualize e tente novamente.';
    document.body.prepend(message);
  });
}
