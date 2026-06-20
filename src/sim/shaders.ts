// Three-pass INERTIAL shallow-water solver — the local-inertial ("acceleration")
// formulation of the 2-D shallow-water (Saint-Venant) equations from Bates, Horritt
// & Fewtrell (2010), the scheme behind LISFLOOD-FP. Unlike the old non-inertial
// virtual-pipes model it STORES a per-face discharge between steps (the momentum /
// ∂q/∂t term), so a flood wave can accelerate, overshoot and reverse — it carries
// real inertia, not just a head-gradient relaxation. Bed friction is the same
// semi-implicit Manning term we already used; the per-cell Manning's n comes from
// the land-cover roughness field (Engman 1986), scaled by `uRoughness`.
//
// Staggered (Arakawa-C / MAC) grid, mirrored line-for-line from the CPU reference
// in inertialFlow.ts (which the unit tests pin for mass conservation, the
// well-balanced lake-at-rest property, stability and the emergence of inertia):
//   • `tWater` rgba = depth, max depth, vx, vy (velocity stays here, so the water
//     renderers are unchanged; it is now a diagnostic computed from the discharge).
//   • `tQ` r,g = discharge per unit width across this cell's EAST and NORTH face.
//
// Three passes per substep:
//   1. MOMENTUM  — update every face's stored discharge from the water surface.
//   2. LIMITER   — per-cell λ ∈ (0,1] (the inertial analogue of the old volume cap)
//      so a cell can't drain more than it holds in one step; a shared face is scaled
//      by its donor's λ, keeping mass conserved and depth ≥ 0 without a clamp.
//   3. DEPTH     — continuity ∂h/∂t = −(∂qx/∂x + ∂qy/∂y) with the limited fluxes,
//      then rain/inject/pour/infiltration/drainage/evaporation/fill + the velocity
//      diagnostic. `resolution` is a #define injected by GPUComputationRenderer.

// Shared GLSL: the face discharge update + the per-cell Manning's n + the open
// domain-edge outflow (memoryless, qOld = 0). hFlow (Cunge) = max(surfaces) − max(beds).
const HELPERS = /* glsl */ `
  uniform sampler2D heightmap;
  uniform sampler2D tWater;
  uniform sampler2D tSurface;
  uniform int uUseSurface;
  uniform float uCellSize;
  uniform float uDt;
  uniform float uGravity;
  uniform float uRoughness;
  uniform float uHMin;
  uniform float uDepression; // depression-storage depth (m) held back from runoff
  uniform float uInfilRate;   // fallback saturated conductivity Ks (m/s) when no surface
  uniform float uSorptivity;  // Green-Ampt S = ψ·Δθ (m); 0 = constant-rate infiltration
  uniform int uBoundaryOpen;

  float manningN(vec2 p) {
    // tSurface.b carries the per-cell Manning n straight from the land-cover table
    // (Engman 1986 overland-flow values), scaled by the global roughness slider.
    float n = (uUseSurface == 1) ? texture2D(tSurface, p).b : 0.03;
    return n * uRoughness;
  }
  // Green-Ampt infiltration capacity (m/s): declines as the cumulative infiltration
  // F (m) grows (the wetting front deepens), → Ks. Mirrors src/sim/infiltration.ts.
  float greenAmptRate(float cumulativeF, float ks) {
    return ks * (1.0 + uSorptivity / max(cumulativeF, 0.002));
  }
  float soilKs(vec2 p) { return (uUseSurface == 1) ? texture2D(tSurface, p).r : uInfilRate; }
  // Per-cell depression storage scaled by surface roughness (rough cover holds more than
  // smooth paving); n already encodes land cover, bounded to [0.25, 2]× the reference.
  float depressionAt(float n) { return uDepression * clamp(n / 0.10, 0.25, 2.0); }
  float faceFlux(float qOld, float etaA, float etaB, float zA, float zB, float n) {
    // Depression storage: the first few mm sit in sub-grid micro-hollows and do not run off —
    // subtract it from the Cunge flow depth (it stays in h / the balance, not a sink).
    float hFlow = max(etaA, etaB) - max(zA, zB) - depressionAt(n);
    if (hFlow <= uHMin) return 0.0; // dry face / below depression storage: no flow, drop momentum
    float slope = (etaB - etaA) / uCellSize;
    float num = qOld - uGravity * hFlow * uDt * slope;
    float den = 1.0 + uGravity * uDt * n * n * abs(qOld) / pow(hFlow, 7.0 / 3.0);
    return num / den;
  }
  // Outflow across a domain edge to dry terrain at the cell's own bed. sign +1 =
  // east/north edge (outflow ≥ 0), −1 = west/south edge (outflow ≤ 0). qOld = 0.
  float edgeFlux(float zC, float hC, float n, float sign) {
    if (uBoundaryOpen == 0 || hC <= uHMin) return 0.0;
    float etaC = zC + hC;
    float f = (sign < 0.0) ? faceFlux(0.0, zC, etaC, zC, zC, n) : faceFlux(0.0, etaC, zC, zC, zC, n);
    return (sign > 0.0) ? max(0.0, f) : min(0.0, f);
  }
`;

// Pass 1: stored discharge on this cell's east + north faces from the water surface.
export const momentumFragment = /* glsl */ `
  ${HELPERS}
  uniform sampler2D tQ; // previous discharge (r = east face, g = north face)
  void main() {
    vec2 res = resolution.xy;
    vec2 uv = gl_FragCoord.xy / res;
    vec2 texel = 1.0 / res;
    float zC = texture2D(heightmap, uv).x;
    float hC = texture2D(tWater, uv).x;
    float etaC = zC + hC;
    float nC = manningN(uv);
    vec4 qOldT = texture2D(tQ, uv);
    vec2 qOld = qOldT.rg;
    float fOld = qOldT.b; // cumulative infiltration F (m), carried in the discharge texture

    float qx;
    if (uv.x + texel.x < 1.0) {
      vec2 e = uv + vec2(texel.x, 0.0);
      float zE = texture2D(heightmap, e).x;
      float etaE = zE + texture2D(tWater, e).x;
      qx = faceFlux(qOld.x, etaC, etaE, zC, zE, 0.5 * (nC + manningN(e)));
    } else {
      qx = edgeFlux(zC, hC, nC, 1.0); // east domain edge
    }

    float qy;
    if (uv.y + texel.y < 1.0) {
      vec2 nn = uv + vec2(0.0, texel.y);
      float zN = texture2D(heightmap, nn).x;
      float etaN = zN + texture2D(tWater, nn).x;
      qy = faceFlux(qOld.y, etaC, etaN, zC, zN, 0.5 * (nC + manningN(nn)));
    } else {
      qy = edgeFlux(zC, hC, nC, 1.0); // north domain edge
    }
    // Advance the per-cell Green-Ampt state F (≈ what soaks in this step); the depth
    // pass removes the matching water using the rate from this F. Rides in .b.
    float fNew = fOld + min(hC, greenAmptRate(fOld, soilKs(uv)) * uDt);
    gl_FragColor = vec4(qx, qy, fNew, 0.0);
  }
`;

// Pass 2: per-cell drainage limiter λ from the four faces draining this cell.
export const limiterFragment = /* glsl */ `
  ${HELPERS}
  uniform sampler2D tQ; // discharge from the momentum pass
  void main() {
    vec2 res = resolution.xy;
    vec2 uv = gl_FragCoord.xy / res;
    vec2 texel = 1.0 / res;
    float zC = texture2D(heightmap, uv).x;
    float hC = texture2D(tWater, uv).x;
    float nC = manningN(uv);
    vec2 qC = texture2D(tQ, uv).rg;
    float qW = (uv.x - texel.x > 0.0) ? texture2D(tQ, uv - vec2(texel.x, 0.0)).x : edgeFlux(zC, hC, nC, -1.0);
    float qS = (uv.y - texel.y > 0.0) ? texture2D(tQ, uv - vec2(0.0, texel.y)).y : edgeFlux(zC, hC, nC, -1.0);
    float drain = (uDt / uCellSize) * (max(0.0, qC.x) + max(0.0, -qW) + max(0.0, qC.y) + max(0.0, -qS));
    float avail = max(0.0, hC - depressionAt(nC)); // roughness-scaled depression reserve held
    float lambda = (drain > avail && drain > 0.0) ? avail / drain : 1.0;
    gl_FragColor = vec4(lambda, 0.0, 0.0, 0.0);
  }
`;

// Pass 3: integrate depth by continuity from the limited fluxes + apply sources/sinks.
export const depthFragment = /* glsl */ `
  ${HELPERS}
  uniform sampler2D tQ; // discharge from the momentum pass
  uniform sampler2D tQprev; // the PREVIOUS discharge texture (its .b = cumulative infiltration F)
  uniform sampler2D tLam; // per-cell limiter from the limiter pass
  uniform float uRainRate;
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
    float zC = texture2D(heightmap, uv).x;
    float nC = manningN(uv);

    bool hasE = uv.x + texel.x < 1.0;
    bool hasN = uv.y + texel.y < 1.0;
    bool hasW = uv.x - texel.x > 0.0;
    bool hasB = uv.y - texel.y > 0.0;
    vec2 qC = texture2D(tQ, uv).rg; // this cell's east + north face
    float qWraw = hasW ? texture2D(tQ, uv - vec2(texel.x, 0.0)).x : edgeFlux(zC, cell.x, nC, -1.0);
    float qSraw = hasB ? texture2D(tQ, uv - vec2(0.0, texel.y)).y : edgeFlux(zC, cell.x, nC, -1.0);

    float lamC = texture2D(tLam, uv).x;
    float lamE = hasE ? texture2D(tLam, uv + vec2(texel.x, 0.0)).x : lamC;
    float lamN = hasN ? texture2D(tLam, uv + vec2(0.0, texel.y)).x : lamC;
    float lamW = hasW ? texture2D(tLam, uv - vec2(texel.x, 0.0)).x : lamC;
    float lamS = hasB ? texture2D(tLam, uv - vec2(0.0, texel.y)).x : lamC;

    // Each face scaled by its donor's λ (the cell it drains), so mass is conserved.
    float qE = qC.x * (qC.x > 0.0 ? lamC : lamE);
    float qN = qC.y * (qC.y > 0.0 ? lamC : lamN);
    float qW = qWraw * (qWraw > 0.0 ? lamW : lamC);
    float qS = qSraw * (qSraw > 0.0 ? lamS : lamC);

    float net = (qE - qW) + (qN - qS);
    float dNew = d - uDt * net / uCellSize;

    float fp = 1.0;
    if (uFootprintSpot == 1) {
      float r = distance(uv, uSpot) / max(1e-4, uSpotRadius);
      fp = 1.0 - smoothstep(0.0, 1.0, r);
    }
    if (uRaining == 1) dNew += uRainRate * uDt * fp;
    dNew += uInjectDepth * fp; // instantaneous dump
    if (uPointDepth > 0.0) {
      float pr = distance(uv, uPointUv) / max(1e-4, uPointRadiusUv);
      dNew += uPointDepth * (1.0 - smoothstep(0.7, 1.0, pr));
    }
    // Green-Ampt infiltration: capacity declines with the per-cell cumulative F
    // (from the start of this step, carried in tQprev.b) — so pervious ground gulps
    // early rain, then saturates and ponds. (The storm sewer is now a separate
    // routing + surcharge subsystem — the sewer passes — not a per-cell sink here.)
    float fOld = texture2D(tQprev, uv).b;
    dNew -= min(dNew, greenAmptRate(fOld, soilKs(uv)) * uDt);
    dNew -= min(dNew, uEvapRate * uDt); // evaporation is a constant depth flux (m/s)
    dNew = max(dNew, 0.0);
    if (uFillLevelAbs > -1.0e8) {
      float fill = max(0.0, uFillLevelAbs - zC);
      dNew = (uFillSet == 1) ? fill : max(dNew, fill);
    }
    maxD = max(maxD, dNew);

    // Diagnostic velocity (render-only): face-averaged discharge / depth (m/s).
    float dbar = max(dNew, 0.02);
    float vx = 0.5 * (qE + qW) / dbar;
    float vy = 0.5 * (qN + qS) / dbar;
    gl_FragColor = vec4(dNew, maxD, vx, vy);
  }
`;

// ── Synthetic storm-sewer subsystem (mirrors sewer.ts) ─────────────────────────
// `tSewer` (static) = (capacity m/s, D8 dirX, D8 dirY, outfall flag). `tSewerState`
// ping-pongs the storage S (.r) + the surcharge scratch (.g). Three passes per
// substep: OUT (inlet + pipe outflow), ROUTE (gather upstream → S + surcharge),
// APPLY (exchange inlet/surcharge with the surface). `S_max = capacity·uSewerBuffer`.

// Pass 1: water entering the pipe (inlet) and the pipe's outflow this step.
export const sewerOutFragment = /* glsl */ `
  uniform sampler2D tWater;
  uniform sampler2D tSewerState;
  uniform sampler2D tSewer;
  uniform float uDt;
  uniform float uSewerBuffer;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float h = max(0.0, texture2D(tWater, uv).x);
    float s = texture2D(tSewerState, uv).r;
    vec4 sw = texture2D(tSewer, uv);
    float cap = sw.r;
    float inlet = min(min(h, cap * uDt), max(0.0, cap * uSewerBuffer - s));
    // An interior D8 pit (no downstream, not an outfall) can't push flow on → it backs up.
    bool interiorPit = abs(sw.g) < 0.5 && abs(sw.b) < 0.5 && sw.a < 0.5;
    float outflow = interiorPit ? 0.0 : min(s + inlet, cap * uDt);
    gl_FragColor = vec4(outflow, inlet, 0.0, 0.0);
  }
`;

// Pass 2: route one cell downstream. Gather each upstream neighbour's outflow (a
// neighbour at offset o drains into us iff its D8 direction is −o), then surcharge.
export const sewerRouteFragment = /* glsl */ `
  uniform sampler2D tOut;
  uniform sampler2D tSewerState;
  uniform sampler2D tSewer;
  uniform float uSewerBuffer;
  float inFrom(vec2 uv, vec2 texel, vec2 o) {
    vec2 p = uv + o * texel;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
    vec2 dir = texture2D(tSewer, p).gb; // neighbour's D8 downstream
    if (abs(dir.x + o.x) < 0.5 && abs(dir.y + o.y) < 0.5) return texture2D(tOut, p).x;
    return 0.0;
  }
  void main() {
    vec2 res = resolution.xy;
    vec2 uv = gl_FragCoord.xy / res;
    vec2 texel = 1.0 / res;
    vec4 self = texture2D(tOut, uv); // outflow (.x), inlet (.y)
    float s = texture2D(tSewerState, uv).r;
    float cap = texture2D(tSewer, uv).r;
    float inflow =
        inFrom(uv, texel, vec2(-1.0, -1.0)) + inFrom(uv, texel, vec2(0.0, -1.0)) + inFrom(uv, texel, vec2(1.0, -1.0))
      + inFrom(uv, texel, vec2(-1.0, 0.0))                                       + inFrom(uv, texel, vec2(1.0, 0.0))
      + inFrom(uv, texel, vec2(-1.0, 1.0)) + inFrom(uv, texel, vec2(0.0, 1.0))  + inFrom(uv, texel, vec2(1.0, 1.0));
    float sNew = s + self.y - self.x + inflow;
    float surcharge = max(0.0, sNew - cap * uSewerBuffer);
    gl_FragColor = vec4(sNew - surcharge, surcharge, 0.0, 0.0);
  }
`;

// Pass 3: exchange with the surface — remove the inlet, add back the surcharge.
export const sewerApplyFragment = /* glsl */ `
  uniform sampler2D tWater;
  uniform sampler2D tOut;
  uniform sampler2D tSewerNew;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 w = texture2D(tWater, uv);
    float inlet = texture2D(tOut, uv).y;
    float surcharge = texture2D(tSewerNew, uv).g;
    float hNew = max(0.0, w.x - inlet + surcharge);
    gl_FragColor = vec4(hNew, max(w.y, hNew), w.z, w.w);
  }
`;
