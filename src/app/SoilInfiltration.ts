// Replaces the literature-default infiltration with the real soil at the scene's location:
// the SoilGrids topsoil texture → Saxton-Rawls Ks AND the Green-Ampt suction, both from the
// SAME soil, so a sandy site gets high Ks + low suction and a clay site the reverse (instead
// of two unrelated knobs). Async + token-guarded so a rapid reload can't apply stale soil;
// until it resolves the caller's defaults stand. Mirrors the GeologyController pattern.
import { fetchSoilTexture } from '../geo/soilgrids';
import { soilHydraulics, greenAmptSorptivityM, type SoilHydraulics } from '../geo/pedotransfer';
import type { Heightmap } from '../geo/heightmap';

export class SoilInfiltration {
  private hydraulics: SoilHydraulics | null = null;
  private token = 0;

  /** Green-Ampt suction-deficit S for the current groundwater state, or undefined until soil lands. */
  sorptivityM(groundwaterHigh: boolean): number | undefined {
    return this.hydraulics ? greenAmptSorptivityM(this.hydraulics, groundwaterHigh) : undefined;
  }

  /**
   * Start fetching the real soil for a freshly built world; clears any prior soil first, and
   * calls `onKs(ksMmPerHr)` once the topsoil resolves (skipped for synthetic worlds / masked
   * pixels / a superseded load).
   */
  load(hm: Heightmap | undefined, onKs: (ksMmPerHr: number) => void): void {
    this.hydraulics = null;
    const token = ++this.token;
    if (!hm || hm.synthetic) return;
    void fetchSoilTexture(hm.center.lat, hm.center.lon).then((tex) => {
      if (token !== this.token || !tex) return;
      const h = soilHydraulics(tex);
      if (!Number.isFinite(h.ksMmPerHr) || !Number.isFinite(h.greenAmptSuctionM)) return; // keep defaults
      this.hydraulics = h;
      onKs(Math.round(h.ksMmPerHr * 10) / 10);
    });
  }
}
