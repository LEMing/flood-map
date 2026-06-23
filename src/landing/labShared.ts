// Shared bits for the landing's interactive physics lab. The single LabWorld is rendered
// two ways (top-down map + side cross-section); these are the constants/types both use.

export const G = 9.81;

/** Per-frame draw context: canvas size (CSS px), rain-animation phase, rain on/off. */
export interface DrawCtx {
  w: number;
  h: number;
  phase: number;
  raining: boolean;
}
