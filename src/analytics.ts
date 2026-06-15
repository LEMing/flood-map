// Google Analytics 4 (gtag.js). The Measurement ID is a PUBLIC id (it ships in
// every GA page's source), so it's safe to commit. It is filled in once Google
// Analytics is enabled on the Firebase project (Project settings → Integrations
// → Google Analytics). While empty, all calls below are no-ops.
const GA_MEASUREMENT_ID = 'G-PENXT4YXW9';

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

export function initAnalytics(): void {
  if (!GA_MEASUREMENT_ID) return;
  const w = window as GtagWindow;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', GA_MEASUREMENT_ID);
}

/** Fire a custom GA4 event (no-op until analytics is configured). */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  const w = window as GtagWindow;
  if (w.gtag) w.gtag('event', name, params ?? {});
}
