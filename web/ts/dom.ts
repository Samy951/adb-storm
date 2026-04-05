/** Safe DOM helper — creates elements without innerHTML */
export function el(
  tag: string,
  attrs?: Record<string, string>,
  ...children: (HTMLElement | string)[]
): HTMLElement {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        element.className = value;
      } else if (key.startsWith('data-')) {
        element.setAttribute(key, value);
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

/** Shortcut for text-only elements */
export function text(tag: string, className: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

/** Create an input element */
export function input(type: string, className: string, placeholder = ''): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = type;
  inp.className = className;
  inp.placeholder = placeholder;
  return inp;
}

/** Create a button */
export function btn(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
