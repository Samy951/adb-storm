import { el, text } from '../dom';
import { sendOffline } from '../api';
import type { Router } from '../router';

const NAV_ITEMS = [
  { icon: '✉', label: 'Messages', route: 'chat' },
  { icon: '☰', label: 'Groups', route: 'channels' },
  { icon: '⏻', label: 'Logout', route: 'logout' },
];

export function renderSidebar(activeRoute: string): HTMLElement {
  const router = (window as any).__router as Router;

  const sidebar = el('div', { className: 'sidebar' });

  // Header
  const header = el('div', { className: 'sidebar__header' },
    text('div', 'sidebar__title', 'Main Menu'),
    text('div', 'sidebar__version', 'v1.0.4')
  );
  sidebar.appendChild(header);

  // Nav buttons
  const nav = el('div', { className: 'sidebar__nav' });

  for (const item of NAV_ITEMS) {
    const isActive = item.route === activeRoute ||
      (item.route === 'channels' && activeRoute === 'channels') ||
      (item.route === 'chat' && activeRoute === 'chat');

    const button = document.createElement('button');
    button.className = `sidebar__btn${isActive ? ' sidebar__btn--active' : ''}`;

    const icon = text('span', 'sidebar__btn-icon', item.icon);
    const label = text('span', '', item.label);

    button.appendChild(icon);
    button.appendChild(label);

    if (item.route === 'logout') {
      button.addEventListener('click', () => {
        sendOffline();
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userId');
        router.navigate('login');
      });
    } else if (item.route) {
      button.addEventListener('click', () => router.navigate(item.route));
    }

    nav.appendChild(button);
  }

  sidebar.appendChild(nav);

  return sidebar;
}
