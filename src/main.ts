import './styles.css';
import type { App } from './app/App';
import { Landing } from './landing/Landing';
import { LanguagePicker } from './ui/LanguagePicker';
import { MethodNote } from './ui/MethodNote';
import { initAnalytics } from './analytics';
import { detectWebGLSupport } from './render/webglSupport';
import { getLanguage, loadLanguage, setLanguage, applyDocumentLang, t, type Lang } from './i18n';
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
let appPromise: Promise<App> | null = null;
let landing: Landing | null = null;
let languagePicker: LanguagePicker;
let methodNote: MethodNote;

interface EnterOpts { cinematic?: boolean; km?: number; grid?: number }

// App pulls in three.js + the post-FX + tweakpane graph (~300 KB gzip), none of
// which the landing needs — so load it lazily on first sim/video entry. The
// promise dedups concurrent mounts (rapid popstate) so only ONE App is built.
function ensureApp(): Promise<App> {
  if (!appPromise) {
    appPromise = import('./app/App')
      .then(({ App }) => {
        app = new App(sceneCanvas, () => { languagePicker.retranslate(); methodNote.translate(); });
        if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
        return app;
      })
      .catch((err) => {
        appPromise = null; // a transient failure (flaky net, redeploy re-hashed the chunk) → let a later mount retry
        throw err;
      });
  }
  return appPromise;
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
    methodNote.translate();
    landing?.retranslate();
    app?.retranslateForLanguage();
  })();
}

// The whole 3D sim renders to float targets; on a device without WebGL2 +
// EXT_color_buffer_float, constructing the App throws (or renders nothing). Fail
// soft to the landing with a clear message instead of an uncaught exception.
function ensureWebGL(): boolean {
  if (detectWebGLSupport().ok) return true;
  showToast(t('toast.webglUnsupported'), true); // the landing also shows an inline note → don't make this persistent
  mountLanding();
  return false;
}

// A sim/video mount can still throw at renderer construction (a GPU crash that
// slips past the WebGL probe). Funnel BOTH the router and the landing CTAs through
// here so such a failure falls back softly to the landing instead of becoming an
// uncaught exception (popstate/Back-Forward in particular runs outside startup).
function safeMount(fn: () => void | Promise<void>): void {
  try {
    void Promise.resolve(fn()).catch(onMountError);
  } catch (err) {
    onMountError(err);
  }
}

function onMountError(err: unknown): void {
  console.error(err);
  showToast(t('toast.loadFailed'), true);
  if (!document.body.classList.contains('landing')) mountLanding();
}

async function mountSim(location?: GeocodeResult, opts?: EnterOpts): Promise<void> {
  if (!ensureWebGL()) return;
  document.body.classList.remove('landing', 'video', 'hero-live');
  const a = await ensureApp();
  if (!window.location.pathname.startsWith('/sim')) return; // route changed during the chunk load
  a.exitVideoMode();
  a.ambient.exit();
  a.ambient.applyScale(opts?.km, opts?.grid);
  a.setActive(true);
  // Seamless handoff: if the ambient hero already built this exact place + scale, go live on it
  // instead of tearing it down and rebuilding (no loading card).
  if (location && a.ambient.isBuiltFor(location)) a.ambient.goLive();
  else if (location) a.startAt(location, {});
  else if (!a.isStarted) a.start();
}

async function mountVideo(location?: GeocodeResult, opts?: EnterOpts): Promise<void> {
  if (!ensureWebGL()) return;
  document.body.classList.remove('landing', 'hero-live');
  document.body.classList.add('video');
  const a = await ensureApp();
  if (!window.location.pathname.startsWith('/video')) return; // route changed during the chunk load
  a.ambient.exit();
  a.ambient.applyScale(opts?.km, opts?.grid);
  a.setActive(true);
  if (location && a.ambient.isBuiltFor(location)) a.enterVideoMode(); // reuse the ambient-built world
  else if (location) a.startAt(location, { cinematic: true });
  else if (!a.isStarted) a.start({ cinematic: true });
  else a.enterVideoMode(); // world already built (e.g. arrived from /sim)
}

// The landing is deliberately WebGL-FREE: a pre-recorded flood loop plays as the hero (the real
// sim captured once), so even a phone or a thermally-throttled laptop loads it instantly without a
// live render. The live sim only spins up when the visitor explicitly enters /sim or /video.
function mountLanding(): void {
  document.body.classList.remove('video');
  document.body.classList.add('landing');
  app?.exitVideoMode();
  app?.setActive(false); // park any kept-alive App; the landing renders no 3D
  if (!landing) landing = new Landing({ onEnter });
  landing.show();
}

function onEnter(location: GeocodeResult, opts: EnterOpts): void {
  writeUrlState({ lat: location.lat, lon: location.lon, km: opts.km, grid: opts.grid });
  const path = opts.cinematic ? '/video' : '/sim';
  history.pushState({}, '', `${path}${window.location.search}`);
  safeMount(() => (opts.cinematic ? mountVideo(location, opts) : mountSim(location, opts)));
}

function route(): void {
  // popstate / app:navigate land here too, OUTSIDE the startup try/catch.
  const p = window.location.pathname;
  if (p.startsWith('/video')) safeMount(mountVideo);
  else if (p.startsWith('/sim')) safeMount(mountSim);
  else mountLanding(); // the landing never constructs WebGL, so it can't throw here
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
  methodNote = new MethodNote(); // in-app flood-model methodology/limitations note
  route();
} catch (err) {
  console.error(err);
  showToast(`Failed to start: ${(err as Error).message}`, true, 0);
}
