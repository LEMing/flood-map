// Conservative single-pass shallow-water (virtual-pipes) solver for
// GPUComputationRenderer. One variable `tWater` holds:
//   r = water depth (m), g = max depth ever, b = velocity x, a = velocity y.
//
// Each cell computes its own AND its neighbours' capped outflow from the SAME
// current water level. Because the flux across a shared edge is computed
// identically from both sides, inflow == outflow on every interior edge, so
// water is exactly conserved. The per-cell cap K (outflow·Δt ≤ stored volume)
// guarantees depth never goes negative — no clamp needed to invent water.
//
// `resolution` and the `tWater` sampler are injected by GPUComputationRenderer;
// `heightmap` and the u* params are added per material.

export const waterFragment = /* glsl */ `
  uniform sampler2D heightmap;
  uniform float uCellSize;
  uniform float uDt;
  uniform float uGravity;
  uniform float uPipeArea;
  uniform float uFriction;
  uniform int uBoundaryOpen;
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
  // Urban surface model: per-cell fields packed as r=infiltration (m/s),
  // g=storm-drain capacity (m/s), b=roughness factor (0..1, scales flux), a=flags.
  uniform sampler2D tSurface;
  uniform int uUseSurface;

  float surf(vec2 p) { return texture2D(heightmap, p).x + texture2D(tWater, p).x; }

  // Capped outflow (L, R, T, B) for the cell at p, given the flux coefficient.
  vec4 outflux(vec2 p, vec2 texel, float coef) {
    float b = texture2D(heightmap, p).x;
    float d = texture2D(tWater, p).x;
    float h = b + d;
    // Per-cell roughness slows flow over grass/cropland vs smooth asphalt.
    float c = (uUseSurface == 1) ? coef * texture2D(tSurface, p).b : coef;
    bool hasL = p.x - texel.x > 0.0;
    bool hasR = p.x + texel.x < 1.0;
    bool hasT = p.y + texel.y < 1.0;
    bool hasB = p.y - texel.y > 0.0;
    float outside = (uBoundaryOpen == 1) ? b : h; // open drains, closed = no flow
    float hL = hasL ? surf(p - vec2(texel.x, 0.0)) : outside;
    float hR = hasR ? surf(p + vec2(texel.x, 0.0)) : outside;
    float hT = hasT ? surf(p + vec2(0.0, texel.y)) : outside;
    float hB = hasB ? surf(p - vec2(0.0, texel.y)) : outside;
    float oL = max(0.0, c * (h - hL));
    float oR = max(0.0, c * (h - hR));
    float oT = max(0.0, c * (h - hT));
    float oB = max(0.0, c * (h - hB));
    float sumO = oL + oR + oT + oB;
    float K = 1.0;
    if (sumO > 0.0) K = min(1.0, d * uCellSize * uCellSize / (uDt * sumO));
    return vec4(oL, oR, oT, oB) * K;
  }

  void main() {
    vec2 res = resolution.xy;
    vec2 uv = gl_FragCoord.xy / res;
    vec2 texel = 1.0 / res;
    float friction = clamp(uFriction, 0.0, 0.95);
    float coef = uDt * uGravity * uPipeArea * (1.0 - friction) / uCellSize;

    vec4 cell = texture2D(tWater, uv);
    float d = cell.x;
    float maxD = cell.y;

    vec4 oC = outflux(uv, texel, coef);
    float outflow = oC.x + oC.y + oC.z + oC.w;

    bool hasL = uv.x - texel.x > 0.0;
    bool hasR = uv.x + texel.x < 1.0;
    bool hasT = uv.y + texel.y < 1.0;
    bool hasB = uv.y - texel.y > 0.0;
    float inL = hasL ? outflux(uv - vec2(texel.x, 0.0), texel, coef).y : 0.0;
    float inR = hasR ? outflux(uv + vec2(texel.x, 0.0), texel, coef).x : 0.0;
    float inT = hasT ? outflux(uv + vec2(0.0, texel.y), texel, coef).w : 0.0;
    float inB = hasB ? outflux(uv - vec2(0.0, texel.y), texel, coef).z : 0.0;
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
