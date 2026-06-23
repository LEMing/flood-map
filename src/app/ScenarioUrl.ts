import { DEFAULT_PARAMS, type Params } from '../config';
import { writeUrlState, type UrlState } from '../url';
import { t } from '../i18n';
import { showToast } from '../ui/toast';

// Keeps the shareable scenario (storm / style / source / flood / look knobs) in
// sync with the /sim URL and owns the one-tap Share button. Only values that
// differ from the defaults are written, so a plain view stays a clean
// lat/lon/km/grid link; a copied link reopens the exact scene.
export class ScenarioUrl {
  private timer = 0;
  private readonly btn = document.getElementById('share-btn') as HTMLButtonElement | null;

  constructor(private readonly params: Params, private readonly placeName: () => string) {
    if (!this.btn) return;
    this.translate();
    this.btn.addEventListener('click', () => void this.share());
  }

  /** Apply the scenario knobs from a deep-linked /sim URL onto params (at boot). */
  applyFromUrl(url: UrlState): void {
    const p = this.params;
    if (url.storm) p.stormType = url.storm;
    if (url.style) p.terrainStyle = url.style;
    if (url.src) p.elevationSource = url.src;
    if (url.water !== undefined) { p.fillLevelM = url.water; p.floodLevelLive = true; p.raining = false; }
    if (url.ve !== undefined) p.verticalExaggeration = url.ve;
    if (url.b3d !== undefined) p.buildings3D = url.b3d;
    if (url.overlay !== undefined) p.floodOverlay = url.overlay;
  }

  /** Debounced mirror of the scenario knobs into the URL (called on param change). */
  queueSync(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.sync(), 500);
  }

  /** Refresh the Share tooltip in the current language. */
  translate(): void {
    if (!this.btn) return;
    this.btn.title = t('share.title');
    this.btn.setAttribute('aria-label', t('share.title'));
  }

  private sync(): void {
    // Scenario params belong to /sim only. The App is kept alive across route
    // swaps, so a debounced timer (or a language-change-driven applyParams) can
    // fire after the user has gone to the landing — bail so it never stamps scene
    // knobs onto the clean "/" URL.
    if (!window.location.pathname.startsWith('/sim')) return;
    const p = this.params;
    const d = DEFAULT_PARAMS;
    writeUrlState({
      storm: p.stormType === d.stormType ? undefined : p.stormType,
      style: p.terrainStyle === d.terrainStyle ? undefined : p.terrainStyle,
      src: p.elevationSource === d.elevationSource ? undefined : p.elevationSource,
      water: p.floodLevelLive ? p.fillLevelM : undefined,
      ve: p.verticalExaggeration === d.verticalExaggeration ? undefined : p.verticalExaggeration,
      b3d: p.buildings3D === d.buildings3D ? undefined : p.buildings3D,
      overlay: p.floodOverlay === d.floodOverlay ? undefined : p.floodOverlay,
    });
  }

  /** One-tap share: native share sheet where available, else copy to clipboard. */
  private async share(): Promise<void> {
    this.sync(); // capture the exact current scene before reading the URL
    const url = window.location.href;
    const title = `${this.placeName()} — Floodlab`;
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('toast.linkCopied'), false);
    } catch {
      showToast(url, false); // clipboard blocked (insecure context) — show the link to copy by hand
    }
  }
}
