// Shared bits for the landing's interactive physics labs. A LabWorld (the shallow-water
// solver) is paired with a renderer: TopView (Rio topography) or UrbanView (a flat city
// grid). These are the constants/types they share.

export const G = 9.81;

/** Per-frame draw context: canvas size (CSS px), rain-animation phase, rain on/off. */
export interface DrawCtx {
  w: number;
  h: number;
  phase: number;
  raining: boolean;
}

/** A pure renderer for the shared LabWorld. */
export interface LabRenderer {
  draw(ctx: CanvasRenderingContext2D, view: DrawCtx): void;
}
