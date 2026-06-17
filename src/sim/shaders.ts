// Conservative two-pass shallow-water (virtual-pipes) solver. The single-pass
// version recomputed every cell's outflux ~5x (self + 4 neighbours) per step to
// read shared-edge flux; this splits it into:
//   1. FLUX pass  — each cell computes its own capped outflux ONCE, written as
//      vec4(oL, oR, oT, oB) into tFlux.
//   2. INTEGRATE pass — each cell reads its own flux + the 4 neighbours'
//      opposing components, updates depth/maxDepth/velocity and applies the
//      rain/inject/pour/infiltration/evaporation/fill terms.
// Inflow across a shared edge is exactly the neighbour's stored capped outflux,
// so mass is conserved identically to the single pass (proven in
// virtualPipes.test.ts) — but with one outflux evaluation per cell, not five.
//
// `tWater` holds r=depth (m), g=max depth ever, b/a=velocity. `resolution` is a
// #define injected by GPUComputationRenderer's createShaderMaterial; the samplers
// and u* params are bound by FloodSimulation each step.

const FLUX_DECLS = /* glsl */ `
  uniform sampler2D heightmap;
  uniform sampler2D tWater;
  uniform sampler2D tSurface;
  uniform int uUseSurface;
  uniform float uCellSize;
  uniform float uDt;
  uniform float uGravity;
  uniform float uPipeArea;
  uniform float uFriction;
  uniform int uBoundaryOpen;

  float surf(vec2 p) { return texture2D(heightmap, p).x + texture2D(tWater, p).x; }
`;

// Pass 1: capped outflow (L, R, T, B) for this cell, from the current water level.
export const fluxFragment = /* glsl */ `
  ${FLUX_DECLS}
  void main() {
    vec2 res = resolution.xy;
    vec2 uv = gl_FragCoord.xy / res;
    vec2 texel = 1.0 / res;
    float friction = clamp(uFriction, 0.0, 0.95);
    float coef = uDt * uGravity * uPipeArea * (1.0 - friction) / uCellSize;

    float b = texture2D(heightmap, uv).x;
    float d = texture2D(tWater, uv).x;
    float h = b + d;
    float c = (uUseSurface == 1) ? coef * texture2D(tSurface, uv).b : coef;
    bool hasL = uv.x - texel.x > 0.0;
    bool hasR = uv.x + texel.x < 1.0;
    bool hasT = uv.y + texel.y < 1.0;
    bool hasB = uv.y - texel.y > 0.0;
    float outside = (uBoundaryOpen == 1) ? b : h; // open drains, closed = no flow
    float hL = hasL ? surf(uv - vec2(texel.x, 0.0)) : outside;
    float hR = hasR ? surf(uv + vec2(texel.x, 0.0)) : outside;
    float hT = hasT ? surf(uv + vec2(0.0, texel.y)) : outside;
    float hB = hasB ? surf(uv - vec2(0.0, texel.y)) : outside;
    float oL = max(0.0, c * (h - hL));
    float oR = max(0.0, c * (h - hR));
    float oT = max(0.0, c * (h - hT));
    float oB = max(0.0, c * (h - hB));
    float sumO = oL + oR + oT + oB;
    float K = 1.0;
    if (sumO > 0.0) K = min(1.0, d * uCellSize * uCellSize / (uDt * sumO));
    gl_FragColor = vec4(oL, oR, oT, oB) * K;
  }
`;

// Pass 2: integrate depth from the precomputed flux field + apply sources/sinks.
export const integrateFragment = /* glsl */ `
  uniform sampler2D heightmap;
  uniform sampler2D tWater;
  uniform sampler2D tFlux;
  uniform sampler2D tSurface;
  uniform int uUseSurface;
  uniform float uCellSize;
  uniform float uDt;
  uniform float uRainRate;
  uniform float uInfilRate;
  uniform float uEvapRate;
  uniform int uRaining;
  uniform int uFootprintSpot;
  uniform vec2 uSpot;
  uniform float uSpotRadius;
  uniform float uInjectDepth; // one-shot water dump (metres) applied this step
  uniform float uPointDepth; // one-shot localized pour (metres) at uPointUv
  uniform vec2 uPointUv; // grid-uv centre of the pour
  uniform float uPointRadiusUv; // pour radius in uv space
  uniform float uFillLevelAbs; // "fill terrain up to this elevation" (< -1e8 = off)
  uniform int uFillSet; // 1 = set water exactly to the level (live), 0 = only raise

  void main() {
    vec2 res = resolution.xy;
    vec2 uv = gl_FragCoord.xy / res;
    vec2 texel = 1.0 / res;

    vec4 cell = texture2D(tWater, uv);
    float d = cell.x;
    float maxD = cell.y;

    vec4 oC = texture2D(tFlux, uv);
    float outflow = oC.x + oC.y + oC.z + oC.w;

    bool hasL = uv.x - texel.x > 0.0;
    bool hasR = uv.x + texel.x < 1.0;
    bool hasT = uv.y + texel.y < 1.0;
    bool hasB = uv.y - texel.y > 0.0;
    float inL = hasL ? texture2D(tFlux, uv - vec2(texel.x, 0.0)).y : 0.0; // left's R
    float inR = hasR ? texture2D(tFlux, uv + vec2(texel.x, 0.0)).x : 0.0; // right's L
    float inT = hasT ? texture2D(tFlux, uv + vec2(0.0, texel.y)).w : 0.0; // top's B
    float inB = hasB ? texture2D(tFlux, uv - vec2(0.0, texel.y)).z : 0.0; // bottom's T
    float inflow = inL + inR + inT + inB;

    float area = uCellSize * uCellSize;
    float dNew = d + uDt * (inflow - outflow) / area;

    float fp = 1.0;
    if (uFootprintSpot == 1) {
      float r = distance(uv, uSpot) / max(1e-4, uSpotRadius);
      fp = 1.0 - smoothstep(0.0, 1.0, r);
    }
    if (uRaining == 1) dNew += uRainRate * uDt * fp;
    dNew += uInjectDepth * fp; // instantaneous dump
    if (uPointDepth > 0.0) { // localized "pour a bucket here" at uPointUv
      float pr = distance(uv, uPointUv) / max(1e-4, uPointRadiusUv);
      dNew += uPointDepth * (1.0 - smoothstep(0.7, 1.0, pr));
    }
    // Losses: per-cell infiltration + storm-drain removal (m/s). Where there is
    // no sewer (Музыкальный/periphery) and impervious ground, almost nothing is
    // removed → water accumulates at the low point. This is the flood trigger.
    float sinkRate = uInfilRate;
    if (uUseSurface == 1) {
      vec2 surf2 = texture2D(tSurface, uv).rg;
      sinkRate = surf2.x + surf2.y; // infiltration + drainage capacity
    }
    dNew -= min(dNew, sinkRate * uDt);
    dNew *= clamp(1.0 - uEvapRate * uDt, 0.0, 1.0);
    dNew = max(dNew, 0.0);
    if (uFillLevelAbs > -1.0e8) {
      float terrain = texture2D(heightmap, uv).x;
      float fill = max(0.0, uFillLevelAbs - terrain); // bathtub depth at this level
      dNew = (uFillSet == 1) ? fill : max(dNew, fill);
    }
    maxD = max(maxD, dNew);

    float dbar = max(dNew, 0.02);
    float vx = 0.5 * ((inL - oC.x) + (oC.y - inR)) / (uCellSize * dbar);
    float vy = 0.5 * ((inB - oC.w) + (oC.z - inT)) / (uCellSize * dbar);

    gl_FragColor = vec4(dNew, maxD, vx, vy);
  }
`;
