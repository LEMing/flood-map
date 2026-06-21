import { AmbientMode, type AmbientModeHost } from './AmbientMode';
import { GRID_RESOLUTIONS } from '../config';
import type { WorldRequest } from '../geo/worldDataCache';
import type { GeocodeResult } from '../geo/geocode';
import type { WorldBuilder } from './WorldBuilder';

export interface AmbientHeroHost extends AmbientModeHost {
  readonly worldBuilder: WorldBuilder;
  requestLoop(): void; // start App's interactive loop + force one render (the handoff to /sim)
}

/**
 * Owns the landing's ambient-flood lifecycle so the App composition root stays thin: builds the
 * hero world (a curated default, or a place the visitor typed), runs the looping {@link AmbientMode}
 * backdrop, tears it down on exit, and decides the seamless handoff into the interactive sim.
 */
export class AmbientHero {
  private mode?: AmbientMode;
  private token = 0;

  constructor(private readonly host: AmbientHeroHost) {}

  /** Build the hero world (token-guarded against a re-typed address / CTA) and start the loop. */
  async enterForHero(req?: WorldRequest): Promise<void> {
    this.exit(); // tear down any running backdrop first (this bumps the token)
    const gen = ++this.token; // capture AFTER exit so our own teardown doesn't invalidate us
    await this.host.worldBuilder.loadHeroCenter(req);
    if (gen !== this.token || !this.host.simDriver.hasSim) return;
    this.mode = new AmbientMode(this.host);
    this.mode.start();
  }

  /** Stop the backdrop and restore the interactive sim's params (no-op if not running). */
  exit(): void {
    this.token++;
    this.mode?.stop();
    this.mode = undefined;
  }

  /** True when the ambient-built world already matches this place at the current (card) scale —
   *  call after {@link applyScale} so it compares the built world against what the CTA will enter. */
  isBuiltFor(loc: GeocodeResult): boolean {
    return this.host.worldBuilder.isBuiltFor(loc, this.host.params.mapSizeKm, this.host.params.gridResolution);
  }

  /** Apply the landing card's map size + grid before a build — the App is constructed at landing
   *  time now, so it can't read these from the URL the way a cold deep-link does. */
  applyScale(km?: number, grid?: number): void {
    const p = this.host.params;
    if (km !== undefined) p.mapSizeKm = km;
    if (grid !== undefined && (GRID_RESOLUTIONS as readonly number[]).includes(grid)) p.gridResolution = grid;
  }

  /** Hand the ambient-built world straight to the interactive sim — no rebuild, no loading card. */
  goLive(): void {
    this.host.requestLoop();
  }
}
