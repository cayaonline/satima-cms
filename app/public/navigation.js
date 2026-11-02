(() => {
  const workspace = document.getElementById('workspace');
  const sidebar = document.getElementById('workspace-sidebar');
  const toggle = document.getElementById('menu-toggle');
  const closeButton = document.getElementById('drawer-close');
  const backdrop = document.getElementById('nav-backdrop');
  const collapse = document.getElementById('sidebar-collapse');
  if (!workspace || !sidebar || !toggle) return;

  const mobile = window.matchMedia('(max-width: 1100px)');
  const prefKey = 'satima-sidebar-collapsed';
  const readCollapsed = () => {
    try { return localStorage.getItem(prefKey) === 'true'; } catch { return false; }
  };
  const writeCollapsed = value => {
    try { localStorage.setItem(prefKey, String(value)); } catch { /* storage may be unavailable */ }
  };
  const focusable = () => [...sidebar.querySelectorAll('a[href],button:not([disabled])')]
    .filter(el => el.getClientRects().length && !el.hasAttribute('hidden'));
  let returnFocus = null;
  let previousInert = false;

  const setCollapsed = value => {
    const collapsed = !mobile.matches && value;
    workspace.classList.toggle('sidebar-collapsed', collapsed);
    if (collapse) {
      collapse.setAttribute('aria-expanded', String(!collapsed));
      collapse.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      collapse.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
    sidebar.querySelectorAll('.nav[data-nav]').forEach(link => {
      link.title = collapsed ? link.getAttribute('aria-label') || link.textContent.trim() : '';
    });
  };

  const closeDrawer = ({ restoreFocus = true } = {}) => {
    workspace.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.querySelector('span').textContent = 'Menu';
    sidebar.removeAttribute('aria-modal');
    sidebar.removeAttribute('role');
    sidebar.inert = mobile.matches;
    const main = workspace.querySelector(':scope > main');
    if (main) main.inert = previousInert;
    document.body.classList.remove('navigation-drawer-open');
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  };

  const openDrawer = () => {
    if (!mobile.matches) return;
    returnFocus = document.activeElement;
    const main = workspace.querySelector(':scope > main');
    previousInert = main?.inert === true;
    if (main) main.inert = true;
    workspace.classList.add('nav-open');
    sidebar.inert = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    toggle.querySelector('span').textContent = 'Close';
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    document.body.classList.add('navigation-drawer-open');
    (closeButton || focusable()[0])?.focus();
  };

  toggle.addEventListener('click', () => workspace.classList.contains('nav-open') ? closeDrawer() : openDrawer());
  closeButton?.addEventListener('click', () => closeDrawer());
  backdrop?.addEventListener('click', () => closeDrawer());
  collapse?.addEventListener('click', () => {
    const next = !workspace.classList.contains('sidebar-collapsed');
    setCollapsed(next);
    writeCollapsed(next);
  });
  sidebar.querySelectorAll('.nav[data-nav]').forEach(link => link.addEventListener('click', () => {
    if (mobile.matches) closeDrawer({ restoreFocus: false });
  }));

  document.addEventListener('keydown', event => {
    if (!workspace.classList.contains('nav-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
    } else if (event.key === 'Tab') {
      const items = focusable();
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });

  const onBreakpoint = () => {
    if (!mobile.matches && workspace.classList.contains('nav-open')) closeDrawer({ restoreFocus: false });
    if (!workspace.classList.contains('nav-open')) sidebar.inert = mobile.matches;
    setCollapsed(readCollapsed());
  };
  mobile.addEventListener?.('change', onBreakpoint);
  onBreakpoint();
})();
