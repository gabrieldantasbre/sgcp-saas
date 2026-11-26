import { api, escapeHtml } from './common.js';

import { showSkeleton } from './common.js';

const DEFAULT_SERVICES = [
  { nome: 'Podoprofilaxia', descricao: 'Cuidado preventivo completo para manter unhas e pés saudáveis e evitar desconfortos.' },
  { nome: 'Calosidades', descricao: 'Avaliação e cuidado de calos dorsais e outras áreas de pressão causadas por atrito.' },
  { nome: 'Unhas encravadas', descricao: 'Técnicas cuidadosas para aliviar o desconforto e prevenir novos episódios.' },
  { nome: 'Onicomicose e onicogrifose', descricao: 'Acompanhamento contínuo para a recuperação da saúde e aparência das unhas.' },
];
const SERVICE_ICONS = ['✦', '◌', '✧', '♡'];

function renderService(service, index) {
  const fallback = DEFAULT_SERVICES[index % DEFAULT_SERVICES.length];
  const name = String(service.nome || fallback.nome);
  const description = String(service.descricao || fallback.descricao);
  const price = service.preco ?? service.valor_referencia;
  const priceLabel = price == null ? '' : Number(price) === 0
    ? 'Gratuito'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(price));
  const number = String(index + 1).padStart(2, '0');

  return '<article class="podology-care-card">' +
    '<span class="podology-care-type">' + 'Procedimento' + '</span>' +
    '<span class="podology-care-icon" aria-hidden="true">' + SERVICE_ICONS[index % SERVICE_ICONS.length] + '</span>' +
    '<span class="podology-care-number" aria-label="Atendimento ' + number + '">' + number + '</span>' +
    '<h3>' + escapeHtml(name) + '</h3>' +
    '<p>' + escapeHtml(description) + '</p>' +
    (priceLabel ? '<small class="podology-care-price">' + escapeHtml(priceLabel) + '</small>' : '') +
    '<a class="podology-care-link" href="/agendar.html">Agendar avaliação <span aria-hidden="true">→</span></a>' +
  '</article>';
}

function bindSiteNavigation() {
  const menuButton = document.querySelector('[data-site-menu]');
  const navigation = document.getElementById('podologyNav');
  if (!menuButton || !navigation) return;

  menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Abrir menu' : 'Fechar menu');
    navigation.classList.toggle('is-open', !isOpen);
  });

  navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Abrir menu');
      navigation.classList.remove('is-open');
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Abrir menu');
      navigation.classList.remove('is-open');
      menuButton.focus();
    }
  });
}

function bindFaq() {
  const items = Array.from(document.querySelectorAll('.podology-faq-item'));
  items.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      items.forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });
}

export async function initSite() {
  bindSiteNavigation();
  bindFaq();
  const destination = document.getElementById('publicServices');
  if (destination) {
    const stopLoading = showSkeleton(destination, 'Carregando serviços da clínica', 4);
    try {
      const services = await api('/api/catalogo');
      destination.innerHTML = (services.length ? services : DEFAULT_SERVICES).map(renderService).join('');
    } catch {
      destination.innerHTML = DEFAULT_SERVICES.map(renderService).join('');
    } finally { stopLoading(); }
  }

  const year = document.querySelector('[data-current-year]');
  if (year) year.textContent = String(new Date().getFullYear());
}
