/**
 * Green-Ampt infiltration: the soil's infiltration CAPACITY declines as water soaks
 * in (the wetting front descends into the soil column), instead of the old constant
 * φ-index. The capacity rate is
 *
 *     f(F) = Ks · (1 + S / F),   S = ψ · Δθ   (suction head × moisture deficit, m)
 *
 * where Ks is the saturated hydraulic conductivity (m/s) and F the cumulative
 * infiltration so far (m). Dry soil (small F) gulps water far faster than Ks; as F
 * grows the term S/F fades and f → Ks. This is what makes a flood trigger LATER on
 * dry pervious ground (the soil absorbs the early rain, then saturates and ponds)
 * and almost immediately on already-wet soil (small Δθ ⇒ small S ⇒ f ≈ Ks at once).
 *
 * Used per-cell on the GPU, where F rides in the discharge texture's B channel; this
 * pure form is the tested spec the shader mirrors. Single-event model: F only
 * accumulates (no soil drying / redistribution between storms).
 */

// Floor on the cumulative infiltration F (m): caps the (otherwise unbounded) initial
// rate of bone-dry soil and avoids a divide-by-zero at F = 0.
export const F_MIN = 2e-3;

/** Green-Ampt infiltration capacity (m/s) at cumulative infiltration `cumulativeF` (m). */
export function greenAmptRate(cumulativeF: number, ksMps: number, sorptivityM: number): number {
  return ksMps * (1 + sorptivityM / Math.max(cumulativeF, F_MIN));
}

/**
 * Advance one step: the depth that actually infiltrates (m, capped by the water
 * present) and the new cumulative F. `dt` in seconds.
 */
export function stepGreenAmpt(
  cumulativeF: number, waterDepth: number, ksMps: number, sorptivityM: number, dt: number,
): { infiltrated: number; newF: number } {
  const capacity = greenAmptRate(cumulativeF, ksMps, sorptivityM) * dt;
  const infiltrated = Math.min(Math.max(waterDepth, 0), capacity);
  return { infiltrated, newF: cumulativeF + infiltrated };
}
