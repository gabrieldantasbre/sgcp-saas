(() => {
  const input = document.getElementById('helpSearch');
  const items = [...document.querySelectorAll('[data-help-item]')];
  const buttons = [...document.querySelectorAll('[data-help-audience]')];
  const status = document.getElementById('helpStatus');
  const clear = document.getElementById('helpClear');
  const params = new URLSearchParams(window.location.search);
  let audience = ['pacientes', 'equipe'].includes(params.get('publico')) ? params.get('publico') : 'todos';
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const searchable = new Map(items.map(item => [item, normalize(item.textContent)]));
  const returnLink = document.getElementById('helpReturn');
  const updateReturn = () => {
    returnLink.href = audience === 'equipe' ? '/interno.html' : '/portal.html';
    returnLink.innerHTML = (audience === 'equipe' ? 'Voltar ao sistema' : 'Ir para meu portal') + ' <span aria-hidden="true">↗</span>';
  };
  function filter() {
    const words = normalize(input.value).split(/\s+/).filter(Boolean);
    let count = 0;
    items.forEach(item => {
      const matches = (audience === 'todos' || item.dataset.audience === 'todos' || item.dataset.audience === audience) && words.every(word => searchable.get(item).includes(word));
      item.hidden = !matches;
      if (matches) count++;
    });
    for (const id of ['helpGuides', 'helpFaq']) {
      const section = document.getElementById(id);
      section.hidden = !section.querySelector('[data-help-item]:not([hidden])');
    }
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.helpAudience === audience)));
    clear.hidden = !input.value;
    document.getElementById('helpEmpty').hidden = count !== 0;
    status.textContent = count + (count === 1 ? ' assunto encontrado' : ' assuntos encontrados');
    updateReturn();
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    audience = button.dataset.helpAudience;
    const nextUrl = new URL(window.location.href);
    if (audience === 'todos') nextUrl.searchParams.delete('publico');
    else nextUrl.searchParams.set('publico', audience);
    history.replaceState(null, '', nextUrl);
    filter();
  }));
  input.addEventListener('input', filter);
  document.getElementById('helpSearchForm').addEventListener('submit', event => { event.preventDefault(); filter(); });
  clear.addEventListener('click', () => { input.value = ''; filter(); input.focus(); });
  document.getElementById('helpReset').addEventListener('click', () => {
    input.value = ''; audience = 'todos';
    const nextUrl = new URL(window.location.href); nextUrl.searchParams.delete('publico'); history.replaceState(null, '', nextUrl);
    filter(); input.focus();
  });
  filter();
})();
