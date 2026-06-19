import { t } from '../i18n';

/** The ⚙ gear: opens/closes the controls drawer (closed by default — the
 *  production view is a clean game UI; every option lives behind the gear).
 *  Clicking outside the panel or pressing Escape closes it. */
export function setupChromeToggle(): void {
  const toggle = document.getElementById('chrome-toggle') as HTMLButtonElement | null;
  const panel = document.getElementById('chrome-panel');
  if (!toggle) return;

  const isOpen = (): boolean => document.body.classList.contains('chrome-open');
  const setOpen = (open: boolean): void => {
    document.body.classList.toggle('chrome-open', open);
    toggle.textContent = open ? '✕' : '⚙';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = t('panel.title');
  };
  setOpen(false);

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen()) return;
    const target = e.target as Node;
    if (toggle.contains(target) || panel?.contains(target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });
}
