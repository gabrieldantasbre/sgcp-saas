// Responsive navigation shares the existing modules and permission-filtered buttons.
export function initAdminMobile() {
  const $ = (id) => document.getElementById(id);
  const media = window.matchMedia('(max-width: 760px)');
  const sidebar = $('internalSidebar');
  const backdrop = $('internalMenuBackdrop');
  const bottomNav = $('internalBottomNav');
  const main = document.querySelector('.internal-main');
  const search = $('globalSearchWrap');
  const searchHome = document.createComment('Desktop search position');
  search.before(searchHome);
  const triggers = [$('openInternalMenu'), $('moreInternalMenu')];
  let returnFocus;
  let open = false;

  function closeMenu(restoreFocus = true) {
    open = false;
    document.body.classList.remove('internal-menu-open');
    backdrop.hidden = true;
    main.inert = false;
    bottomNav.inert = false;
    sidebar.inert = media.matches;
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    triggers.forEach((button) => button.setAttribute('aria-expanded', 'false'));
    if (restoreFocus && returnFocus?.isConnected && media.matches) returnFocus.focus({ preventScroll: true });
  }
  function openMenu(event) {
    if (!media.matches) return;
    returnFocus = event.currentTarget;
    open = true;
    sidebar.inert = false;
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    backdrop.hidden = false;
    document.body.classList.add('internal-menu-open');
    triggers.forEach((button) => button.setAttribute('aria-expanded', 'true'));
    $('closeInternalMenu').focus({ preventScroll: true });
    main.inert = true;
    bottomNav.inert = true;
  }
  triggers.forEach((button) => button.addEventListener('click', openMenu));
  $('closeInternalMenu').addEventListener('click', () => closeMenu());
  backdrop.addEventListener('click', () => closeMenu());
  sidebar.querySelector('.mobile-site-link').addEventListener('click', () => closeMenu());
  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    if (event.key !== 'Tab') return;
    const items = Array.from(sidebar.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]')).filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  function adaptLayout() {
    const focusedInSidebar = sidebar.contains(document.activeElement);
    const focusedInMobileNav = bottomNav.contains(document.activeElement) || triggers.includes(document.activeElement) || document.activeElement === $('closeInternalMenu') || document.activeElement === sidebar.querySelector('.mobile-site-link');
    closeMenu(false);
    if (media.matches) document.querySelector('.internal-page-heading').after(search);
    else searchHome.after(search);
    if (focusedInSidebar && media.matches) $('openInternalMenu').focus({ preventScroll: true });
    else if (focusedInMobileNav && !media.matches) $('internalTitle').focus({ preventScroll: true });
  }
  media.addEventListener('change', adaptLayout);
  adaptLayout();

  return {
    onNavigate(tab) {
      const shortcuts = Array.from(bottomNav.querySelectorAll('[data-go]'));
      shortcuts.forEach((button) => {
        const active = !button.hidden && button.dataset.go === tab;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      $('moreInternalMenu').classList.toggle('active', !shortcuts.some((button) => !button.hidden && button.dataset.go === tab));
      closeMenu(false);
      if (media.matches) {
        $('globalSearchResults').hidden = true;
        window.scrollTo({ top: 0, behavior: 'instant' });
        $('internalTitle').focus({ preventScroll: true });
      }
    },
  };
}
