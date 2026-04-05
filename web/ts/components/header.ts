import { el, text } from '../dom';

export function renderAppHeader(title: string): HTMLElement {
  return el('div', { className: 'app-header' },
    el('div', { className: 'app-header__title' },
      text('span', '', '▣'),
      text('span', '', title)
    )
  );
}
