import './styles.css';
import { App } from './app/App';
import { Landing } from './landing/Landing';
import { initAnalytics } from './analytics';
import { getLanguage, loadLanguage, applyDocumentLang } from './i18n';
import { showToast } from './ui/toast';
import { writeUrlState } from './url';
import type { GeocodeResult } from './geo/geocode';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #scene not found');
}
const sceneCanvas: HTMLCanvasElement = canvas;

initAnalytics();

// Two surfaces in one SPA: the landing ("/") and the sim ("/sim"). The App is
// created lazily on first sim entry and kept alive across route swaps (so the
// in-memory world handoff and the warm GPU context survive a Back/Forward); the
// landing just pauses it (setActive(false)) and hides the canvas via body.landing.
let app: App | null = null;
let landing: Landing | null = null;

function ensureApp(): App {
  if (!app) {
    app = new App(sceneCanvas);
    if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
  }
  return app;
}

function mountSim(opts: { location?: GeocodeResult; cinematic?: boolean } = {}): void {
  document.body.classList.remove('landing');
  const a = ensureApp();
  a.setActive(true);
  if (opts.location) a.startAt(opts.location, { cinematic: opts.cinematic });
  else if (!a.isStarted) a.start();
}

function mountLanding(): void {
  document.body.classList.add('landing');
  app?.setActive(false);
  if (!landing) landing = new Landing({ onEnter });
  landing.show();
}

function onEnter(location: GeocodeResult, opts: { cinematic?: boolean }): void {
  writeUrlState({ lat: location.lat, lon: location.lon });
  history.pushState({}, '', `/sim${window.location.search}`);
  mountSim({ location, cinematic: opts.cinematic });
}

function route(): void {
  if (window.location.pathname.startsWith('/sim')) mountSim();
  else mountLanding();
}

window.addEventListener('popstate', route);

try {
  // Pull the active locale's lazy chunk in before the first render so the UI
  // builds translated (not an English flash). English is bundled as the fallback.
  await loadLanguage(getLanguage());
  applyDocumentLang(); // set <html lang/dir> up front so an RTL locale mirrors on first paint
  route();
} catch (err) {
  console.error(err);
  showToast(`Failed to start: ${(err as Error).message}`, true, 0);
}
