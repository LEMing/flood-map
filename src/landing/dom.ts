import { el } from '../ui/dom';

// Landing-card-specific DOM builders (the generic el()/button() live in ui/dom).

export function chip(icon: string, text: string, extra = ''): HTMLSpanElement {
  const c = el('span', 'lp-chip' + (extra ? ` ${extra}` : ''));
  if (icon) {
    const i = el('span', 'ic');
    i.textContent = icon;
    c.appendChild(i);
  }
  c.appendChild(document.createTextNode(text));
  return c;
}

export function spinner(): HTMLSpanElement {
  return el('span', 'spin');
}
