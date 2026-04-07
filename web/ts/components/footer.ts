import { el, text } from '../dom';

export function renderAppFooter(): HTMLElement {
  const username = localStorage.getItem('username') || 'Guest';

  return el('div', { className: 'app-footer' },
    el('div', { className: 'app-footer__left' },
      text('span', '', '● System Status: Ready'),
      text('span', '', `Logged in as: ${username}`),
      text('span', '', 'Server: SOVEREIGN-01')
    ),
    el('div', { className: 'app-footer__right' },
      text('a', '', 'Help'),
      text('a', '', 'About')
    )
  );
}
