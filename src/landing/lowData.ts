// Whether the visitor has signalled they don't want costly motion/data — used to keep the
// landing on its lightweight static path (no live 3D hero, no autoplaying media) under
// reduced-motion or a Save-Data connection.

export function prefersLowData(): boolean {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return reduced || conn?.saveData === true;
}
