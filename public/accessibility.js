(() => {
  const key = 'sgcp_high_contrast';
  let contrast = false;
  try { contrast = localStorage.getItem(key) === 'true'; } catch {}
  const tools = document.createElement('div');
  tools.className = 'accessibility-tools';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Alto contraste';
  button.title = 'Ativar ou desativar alto contraste';
  const apply = () => {
    document.documentElement.classList.toggle('high-contrast', contrast);
    button.setAttribute('aria-pressed', String(contrast));
  };
  button.addEventListener('click', () => {
    contrast = !contrast;
    apply();
    try { localStorage.setItem(key, String(contrast)); } catch {}
  });
  tools.append(button);
  document.body.append(tools);
  apply();

  const main = document.querySelector('main');
  if (main) {
    if (!main.id) main.id = 'conteudo';
    main.tabIndex = -1;
    if (!document.querySelector('.skip-link, .podology-skip-link')) {
      const skip = document.createElement('a');
      skip.href = '#' + main.id;
      skip.className = 'skip-link';
      skip.textContent = 'Pular para o conteúdo';
      document.body.prepend(skip);
    }
  }
})();
