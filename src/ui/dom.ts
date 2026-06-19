// Tiny DOM element builders shared across the UI (landing card, video overlay).

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
