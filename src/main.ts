import './styles.css';
import { App } from './app/App';
import { Landing } from './landing/Landing';
import { LanguagePicker } from './ui/LanguagePicker';
import { initAnalytics } from './analytics';
import { getLanguage, loadLanguage, setLanguage, applyDocumentLang, type Lang } from './i18n';
import { showToast } from './ui/toast';
import { writeUrlState } from './url';
import type { GeocodeResult } from './geo/geocode';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #scene not found');
}
const sceneCanvas: HTMLCanvasElement = canvas;

initAnalytics();

// Three surfaces in one SPA: the landing ("/"), the live sim ("/sim") and the
// cinematic video page ("/video"). The App is created lazily on first sim/video
// entry and kept alive across route swaps (so the in-memory world handoff and the
// warm GPU context survive Back/Forward); the landing just pauses it
// (setActive(false)) and hides the canvas via body.landing.
let app: App | null = null;
let landing: Landing | null = null;
let languagePicker: LanguagePicker;

interface EnterOpts { cinematic?: boolean; km?: number; grid?: number }

function ensureApp(): App {
  if (!app) {
    app = new App(sceneCanvas, () => languagePicker.retranslate());
    if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
  }
  return app;
}

// Language is a surface-wide concern, so the picker is owned here (shared by the
// landing and the sim) rather than by the App.
function onLanguageChange(lang: Lang): void {
  void (async () => {
    await loadLanguage(lang);
    setLanguage(lang);
    writeUrlState({ lang });
    applyDocumentLang();
    languagePicker.retranslate();
    landing?.retranslate();
    app?.retranslateForLanguage();
  })();
}

function mountSim(location?: GeocodeResult): void {
  document.body.classList.remove('landing', 'video');
  const a = ensureApp();
  a.exitVideoMode();
  a.setActive(true);
  if (location) a.startAt(location, {});
  else if (!a.isStarted) a.start();
}

function mountVideo(location?: GeocodeResult): void {
  document.body.classList.remove('landing');
  document.body.classList.add('video');
  const a = ensureApp();
  a.setActive(true);
  if (location) a.startAt(location, { cinematic: true });
  else if (!a.isStarted) a.start({ cinematic: true });
  else a.enterVideoMode(); // world already built (e.g. arrived from /sim)
}

function mountLanding(): void {
  document.body.classList.remove('video');
  document.body.classList.add('landing');
  app?.exitVideoMode();
  app?.setActive(false);
  if (!landing) landing = new Landing({ onEnter });
  landing.show();
}

function onEnter(location: GeocodeResult, opts: EnterOpts): void {
  writeUrlState({ lat: location.lat, lon: location.lon, km: opts.km, grid: opts.grid });
  const path = opts.cinematic ? '/video' : '/sim';
  history.pushState({}, '', `${path}${window.location.search}`);
  if (opts.cinematic) mountVideo(location);
  else mountSim(location);
}

function route(): void {
  const p = window.location.pathname;
  if (p.startsWith('/video')) mountVideo();
  else if (p.startsWith('/sim')) mountSim();
  else mountLanding();
}

window.addEventListener('popstate', route);
// VideoMode (in src/app) asks the router to switch pages without importing it.
window.addEventListener('app:navigate', (e) => {
  const to = (e as CustomEvent<string>).detail;
  const path = to === 'sim' ? '/sim' : '/';
  history.pushState({}, '', `${path}${window.location.search}`);
  route();
});

try {
  // Pull the active locale's lazy chunk in before the first render so the UI
  // builds translated (not an English flash). English is bundled as the fallback.
  await loadLanguage(getLanguage());
  applyDocumentLang(); // set <html lang/dir> up front so an RTL locale mirrors on first paint
  languagePicker = new LanguagePicker(onLanguageChange); // shared top-right picker
  route();
} catch (err) {
  console.error(err);
  showToast(`Failed to start: ${(err as Error).message}`, true, 0);
}
