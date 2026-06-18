import type { GeocodeResult } from '../geo/geocode';
import { parseCoords } from '../url';

// Small DOM builders shared by the landing card.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function button(className: string, label: string): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.textContent = label;
  return b;
}

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

/** Trim a geocode display name to its two most specific parts (or raw coords). */
export function shortLabel(location: GeocodeResult): string {
  if (parseCoords(location.displayName)) return location.displayName;
  return location.displayName.split(',').slice(0, 2).map((s) => s.trim()).join(', ');
}
