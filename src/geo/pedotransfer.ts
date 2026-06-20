/**
 * Soil hydraulic properties from texture — the Saxton & Rawls (2006) pedotransfer
 * functions ("Soil Water Characteristic Estimates by Texture and Organic Matter for
 * Hydrologic Solutions", SSSAJ 70:1569–1578). Given sand %, clay % and organic-matter %
 * (the topsoil composition ISRIC SoilGrids reports), they estimate the saturated water
 * content θs, field capacity θ33, wilting point θ1500, the air-entry tension, and the
 * saturated conductivity Ks — and from those the Green-Ampt parameters the flood solver
 * needs (Ks and the wetting-front suction).
 *
 * The point of routing BOTH Ks and the suction through one texture is internal
 * consistency: a sandy soil comes out with high Ks AND low suction; a clayey soil with
 * low Ks AND high suction — instead of the two being set by unrelated knobs. The numbers
 * are pinned against the textbook ordering/ranges in pedotransfer.test.ts.
 */

export interface SoilTextureInput {
  sandFrac: number; // 0–1
  clayFrac: number; // 0–1
  omPct: number; // organic matter, % by weight
}

export interface SoilHydraulics {
  thetaS: number; // saturation water content (porosity), m³/m³
  theta33: number; // field capacity (−33 kPa), m³/m³
  theta1500: number; // wilting point (−1500 kPa), m³/m³
  ksMmPerHr: number; // saturated hydraulic conductivity
  airEntryM: number; // air-entry (bubbling) head, m of water
  lambda: number; // Brooks–Corey pore-size index
  greenAmptSuctionM: number; // wetting-front suction head for Green-Ampt, m
}

const KPA_TO_M = 1 / 9.80665; // 1 kPa of water ≈ 0.102 m head

/** Saxton & Rawls (2006) estimates for one soil texture. */
export function soilHydraulics(input: SoilTextureInput): SoilHydraulics {
  const S = clamp01(input.sandFrac);
  const C = clamp01(input.clayFrac);
  const OM = Math.max(0, input.omPct);

  // Wilting point θ1500 (eq. 1–2).
  const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * (S * OM) - 0.013 * (C * OM) + 0.068 * (S * C) + 0.031;
  const theta1500 = t1500 + (0.14 * t1500 - 0.02);

  // Field capacity θ33 (eq. 3–4).
  const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * (S * OM) - 0.027 * (C * OM) + 0.452 * (S * C) + 0.299;
  const theta33 = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);

  // Saturation-minus-field-capacity θ(S-33) (eq. 5–6).
  const ts33 = 0.278 * S + 0.034 * C + 0.022 * OM - 0.018 * (S * OM) - 0.027 * (C * OM) - 0.584 * (S * C) + 0.078;
  const thetaS33 = ts33 + (0.636 * ts33 - 0.107);

  // Saturation θs (eq. 7).
  const thetaS = theta33 + thetaS33 - 0.097 * S + 0.043;

  // Air-entry tension ψe, kPa (eq. 8–9).
  const pet = -21.67 * S - 27.93 * C - 81.97 * thetaS33 + 71.12 * (S * thetaS33)
    + 8.29 * (C * thetaS33) + 14.05 * (S * C) + 27.16;
  const psiEntryKpa = Math.max(0, pet + (0.02 * pet * pet - 0.113 * pet - 0.70));

  // Brooks–Corey slope and saturated conductivity (eq. 15–16). Floor the moisture-tension
  // points before the logs: the θ regressions go tiny/negative for near-pure sand (C≈0,
  // OM≈0), which would otherwise make B/λ/Ks NaN and poison the whole water field.
  const safe1500 = Math.max(0.01, theta1500);
  const safe33 = Math.max(safe1500 + 1e-3, theta33);
  const B = (Math.log(1500) - Math.log(33)) / (Math.log(safe33) - Math.log(safe1500));
  const lambda = 1 / B;
  const ksMmPerHr = 1930 * Math.pow(Math.max(1e-3, thetaS - theta33), 3 - lambda);

  // Green-Ampt wetting-front suction ≈ the soil air-entry head, bounded to the Rawls et al.
  // (1983) texture envelope (sand ~0.05 m → clay ~0.32 m). Air entry is the capillary scale;
  // the consumed deficit S = ψf·Δθ is capped again at 0.15 m in greenAmptSorptivityM.
  const airEntryM = psiEntryKpa * KPA_TO_M;
  const greenAmptSuctionM = Math.min(0.35, Math.max(0.05, airEntryM));

  return { thetaS, theta33, theta1500, ksMmPerHr, airEntryM, lambda, greenAmptSuctionM };
}

/**
 * Green-Ampt suction-deficit S = ψf · Δθ (m), with Δθ the moisture the wetting front can
 * still absorb. Antecedent moisture sets Δθ: normally the soil sits near field capacity, so
 * Δθ = θs − θ33 (the drainable porosity); a high water table leaves little room, so Δθ
 * collapses toward zero and infiltration drops to Ks almost at once (подтопление).
 */
export function greenAmptSorptivityM(h: SoilHydraulics, groundwaterHigh: boolean): number {
  const drainable = Math.max(0, h.thetaS - h.theta33);
  const deltaTheta = groundwaterHigh ? 0.1 * drainable : drainable;
  // Bound the lumped suction-deficit to the Rawls et al. (1983) Green-Ampt range so a
  // high-air-entry silt can't blow it past the literature envelope.
  return Math.min(0.15, h.greenAmptSuctionM * deltaTheta);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
