// Shared bits for the landing's interactive physics lab. Two interchangeable scenes
// (a 1D cross-section and a 2D top-down city) run the same local-inertial shallow-water
// scheme on CPU; the MiniFlood controller owns the canvas, controls and loop, and just
// delegates step()/draw() to whichever scene is active.

export const G = 9.81;

/** Per-frame draw context: canvas size (CSS px), rain-animation phase, rain on/off. */
export interface DrawCtx {
  w: number;
  h: number;
  phase: number;
  raining: boolean;
}

export interface LabScene {
  /** Drain the scene back to dry ground. */
  reset(): void;
  /** Advance the sim by `simSeconds` (CFL-substepped internally), with rain on or off. */
  step(simSeconds: number, raining: boolean): void;
  /** Paint the current state into the canvas. */
  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void;
  /** Deepest water (m) and share of ground under water (0..1) — for the live readout. */
  readonly maxDepth: number;
  readonly pondedFrac: number;
  /** The auto-demo stops the rain once peaked() and restarts it once drained(). */
  peaked(): boolean;
  drained(): boolean;
}

/** Gaussian bump, height 1 at x=m, width s (in normalised 0..1 coords). */
export function bump(x: number, m: number, s: number): number {
  const t = (x - m) / s;
  return Math.exp(-t * t);
}
