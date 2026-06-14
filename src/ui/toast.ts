const el = () => document.getElementById('toast') as HTMLDivElement;
let timer: number | undefined;

export function showToast(message: string, isError = false, durationMs = 4500): void {
  const node = el();
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.classList.add('show');
  if (timer) window.clearTimeout(timer);
  if (durationMs > 0) {
    timer = window.setTimeout(() => node.classList.remove('show'), durationMs);
  }
}

export function hideToast(): void {
  el().classList.remove('show');
}
