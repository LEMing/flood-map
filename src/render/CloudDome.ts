import * as THREE from 'three';

// Raymarched volumetric cloud DOME — a BackSide sphere recentred on the camera
// each frame. The fragment shader reconstructs the world view ray and marches a
// world-space cloud slab (Nubis-style coverage + height-gradient + Worley
// erosion density, Heckel/Nubis Beer-powder + dual-lobe HG lighting, iq
// front-to-back integration) plus an analytic storm sky, so clouds read as full
// 3D from horizon to zenith. Outputs LINEAR HDR; the renderer's ACES tonemap is
// applied once (toneMapped:true), so do NOT tonemap in the shader.
// Synthesized from iq Clouds, Guerrilla "Nubis", Maxime Heckel and Sebastian Lague.

const CLOUD_DOME_VERT = `// Dome vertex shader. The sphere is recentered on the camera every frame, so
// object-space \`position\` already points along the world view direction. We go
// through modelMatrix so a rotated/scaled dome stays correct, and subtract the
// camera origin to get a true world-space view ray for the fragment stage.
precision highp float;

varying vec3 vWorldDir;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = worldPos.xyz - cameraPosition;   // built-in three.js uniform for ShaderMaterial

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CLOUD_DOME_FRAG = `precision highp float;

// ----------------------------------------------------------------------------
//  STORM CLOUD DOME  —  raymarched world-space cumulonimbus slab
//  Lague/Nubis density (coverage remap + height gradient + erosion),
//  Heckel/Nubis lighting (Beer light-march + dual-lobe HG + beer-powder),
//  iq front-to-back premultiplied integration + directional-derivative dark
//  base, analytic storm sky, in-scatter lightning.
//
//  OUTPUT IS LINEAR HDR.  Tonemapping + gamma are applied ONCE by the renderer
//  (renderer.toneMapping = ACESFilmic) via <tonemapping_fragment> because the
//  material is built with toneMapped:true.  Do NOT tonemap here.
// ----------------------------------------------------------------------------

varying vec3 vWorldDir;

uniform float uTime;       // seconds, drives wind drift
uniform float uStorm;      // 0 = calm few clouds .. 1 = full apocalyptic storm
uniform float uFlash;      // 0 .. ~1.5 lightning impulse
uniform vec3  uSunDir;     // normalized, world space (points TO the sun)
uniform vec3  uCamPos;     // camera world position (ray origin for the slab)
uniform vec3  uSunColor;   // warm key light, e.g. vec3(1.0, 0.96, 0.88)
uniform vec3  uFlashColor; // cool blue-white, e.g. vec3(0.55, 0.65, 1.0)

uniform float uCloudBase;  // world meters, cloud-deck bottom
uniform float uCloudTop;   // world meters, cloud-deck top
uniform float uCoverage;   // extra coverage push (added on top of uStorm), 0 default
uniform float uDensityMul; // global density scaler, ~1.0
uniform float uExposure;   // pre-tonemap cloud/sky balance scalar, ~0.9

// ============================================================================
//  CONSTANTS  (compile-time loop bounds)
// ============================================================================
#define PI            3.14159265359
#define STEPS         18      // primary march steps (fewer = faster; dt spans the
                              // whole slab so coverage is preserved at all angles)
#define LIGHT_STEPS   4       // sun light-march taps
#define MAX_DIST      55000.0 // cap grazing-horizon ray length (meters)
#define DT_MAX        3200.0  // >= MAX_DIST/STEPS, so dt never clamps: the few
                              // steps always cover the full slab (no thin horizon)
#define SIGMA_E       1.8     // view extinction (per density * km): opaque masses, soft wisp edges
#define SIGMA_L       0.060   // light-march extinction
#define GRAD_GAIN     7.0     // iq dark-base hardness
#define KM            0.001    // meters -> "kilo-meters" so optical depth stays sane

// ============================================================================
//  PROCEDURAL NOISE  (texture-free)
// ============================================================================
float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(p + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(p + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(p + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(p + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(p + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(p + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(p + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(p + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

// Worley (cellular F1) — puffy "billow" cores the value noise lacks.
float worley(vec3 p) {
    vec3 id = floor(p);
    vec3 fp = fract(p);
    float d = 1.0;
    for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 o = vec3(hash13(id + g),
                      hash13(id + g + 19.19),
                      hash13(id + g + 37.37));
        vec3 r = g + o - fp;
        d = min(d, dot(r, r));
    }
    return sqrt(d); // 0 at cell centers .. ~1 at edges
}

// Decorrelating rotation per octave (iq) to kill axis-aligned tiling.
// Verified orthonormal (det = 1, M*Mᵀ = I).
const mat3 M = mat3( 0.00,  0.80,  0.60,
                    -0.80,  0.36, -0.48,
                    -0.60, -0.48,  0.64);

// Perlin-Worley-ish base shape: value-noise fbm dilated by an inverted Worley
// so cloud masses get rounded cauliflower cores.
float shapeFBM(vec3 p) {
    float n = 0.0;
    float a = 0.5;
    vec3 q = p;
    for (int i = 0; i < 4; i++) {
        n += a * vnoise(q);
        q = M * q * 2.02;
        a *= 0.5;
    }
    float w = 1.0 - worley(p * 1.3); // dense at cell centers
    return clamp(mix(w, n, 0.45), 0.0, 1.0);
}

// Cheaper, higher-frequency erosion field (curls / wisps at edges).
float detailFBM(vec3 p) {
    float n = 0.0;
    float a = 0.5;
    vec3 q = p;
    for (int i = 0; i < 3; i++) {
        n += a * (1.0 - worley(q));
        q = M * q * 2.03;
        a *= 0.5;
    }
    return clamp(n, 0.0, 1.0);
}

float remap(float v, float a, float b, float c, float d) {
    return c + clamp((v - a) / (b - a), 0.0, 1.0) * (d - c);
}

// ============================================================================
//  DENSITY  (world point -> [0,1] storm-cell density)
// ============================================================================
float cloudDensity(vec3 p) {
    float thickness = uCloudTop - uCloudBase;
    float hf = clamp((p.y - uCloudBase) / thickness, 0.0, 1.0);

    // Cumulonimbus height gradient: crisp flat dark base, tall billowing body,
    // a spreading anvil shelf near the top.
    float base  = smoothstep(0.00, 0.07, hf);
    float top   = 1.0 - smoothstep(0.55, 1.00, hf);
    float anvil = smoothstep(0.78, 0.90, hf) * (1.0 - smoothstep(0.90, 1.00, hf));
    float hgrad = base * top + anvil * 0.55;

    // Wind drift (horizontal shear only; vertical advection would make the deck "boil").
    vec3 drift = vec3(uTime * 9.0, 0.0, uTime * 4.0);

    // Base shape + coverage remap (Schneider/Lague: raise coverage -> grow area).
    float shapeScale = 0.00020; // ~5 km base cell; see TUNING
    float shape = shapeFBM((p + drift) * shapeScale);

    // uStorm=0 -> broken cumulus; uStorm=1 -> heavy but still structured (gaps
    // keep it dramatic instead of a flat overcast smear).
    float cov = clamp(mix(0.40, 0.62, uStorm) + uCoverage, 0.0, 0.97);
    float dens = remap(shape, 1.0 - cov, 1.0, 0.0, 1.0);
    dens *= hgrad;
    if (dens <= 0.0) return 0.0;

    // Detail erosion — only bites wispy edges (low shape); cores stay solid.
    float det = detailFBM((p + drift * 1.7) * shapeScale * 4.5);
    float erodeW = 1.0 - shape;
    erodeW = erodeW * erodeW * erodeW;
    dens = remap(dens, det * 0.55 * erodeW, 1.0, 0.0, 1.0);

    // Mammatus-like pouches hanging under the flat base (storm ceiling).
    float mam = detailFBM((p + 17.0) * shapeScale * 3.0);
    float under = smoothstep(0.12, 0.0, hf);
    dens += under * (mam - 0.5) * 0.20;

    return clamp(dens, 0.0, 1.0) * uDensityMul * (1.0 + 0.4 * uStorm);
}

// ============================================================================
//  PHASE  (dual-lobe Henyey-Greenstein: forward silver lining + soft back)
// ============================================================================
float hg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
float cloudPhase(float c) {
    return mix(hg(c, 0.78), hg(c, -0.28), 0.30) + 0.04; // small ambient lobe
}

// ============================================================================
//  SUN LIGHT-MARCH  (Beer's law toward the sun, growing cone-ish steps)
// ============================================================================
float lightMarch(vec3 p) {
    float ls = 140.0;
    float od = 0.0;
    vec3 lp = p;
    for (int i = 0; i < LIGHT_STEPS; i++) {
        lp += uSunDir * ls;
        od += cloudDensity(lp) * ls;
        ls *= 1.5; // far taps reach big occluders cheaply (cheap multiscatter)
    }
    return od;
}

// ============================================================================
//  ANALYTIC STORM SKY  (replaces scene.background entirely)
// ============================================================================
vec3 stormSky(vec3 rd) {
    float up = clamp(rd.y, 0.0, 1.0);

    vec3 zenith  = mix(vec3(0.30, 0.38, 0.52), vec3(0.07, 0.09, 0.13), uStorm);
    vec3 horizon = mix(vec3(0.66, 0.70, 0.76), vec3(0.24, 0.27, 0.32), uStorm);
    vec3 sky = mix(horizon, zenith, pow(up, 0.5));

    // Hazy sun aureole, muted through storm.
    float sun = max(dot(rd, uSunDir), 0.0);
    sky += mix(vec3(1.0, 0.85, 0.6), vec3(0.4, 0.42, 0.5), uStorm)
         * pow(sun, 8.0) * (1.0 - 0.7 * uStorm);

    // Ground-haze murk below the horizon so the slab edge is hidden when looking down.
    sky = mix(vec3(0.05, 0.055, 0.065), sky, smoothstep(-0.06, 0.05, rd.y));

    // Sky-wide lightning bloom, strongest low in the sky.
    sky += uFlashColor * uFlash * (0.18 + 0.4 * (1.0 - up));

    return sky;
}

// ============================================================================
//  CLOUD RAYMARCH  (world-space slab, front-to-back, energy-conserving)
// ============================================================================
vec3 renderClouds(vec3 ro, vec3 rd, vec3 sky, float dither) {
    // Looking down / along the horizon: ray never crosses the slab -> pure sky.
    // (Also the sole div-by-zero guard for the 1/rd.y intersection below.)
    if (rd.y <= 0.004) return sky;

    // Camera above the deck would invert the slab; bail to sky (fly-cam safety).
    if (ro.y >= uCloudTop) return sky;

    float invRy = 1.0 / rd.y;
    float t0 = max((uCloudBase - ro.y) * invRy, 0.0);
    float t1 = min((uCloudTop  - ro.y) * invRy, MAX_DIST);
    if (t1 <= t0) return sky;

    // Path length grows as 1/rd.y -> long near the horizon (clouds pile up),
    // short at the zenith. Cap dt so near-horizon samples stay finer than the
    // ~1.1 km smallest feature; transmittance early-out reclaims the cost.
    float dt = (t1 - t0) / float(STEPS);
    dt = clamp(dt, 24.0, DT_MAX);
    float t = t0 + dt * dither;

    float mu = dot(rd, uSunDir);
    float phase = cloudPhase(mu);

    vec3  sunCol = uSunColor * (1.0 - 0.55 * uStorm);
    float thickness = uCloudTop - uCloudBase;

    float T = 1.0;          // transmittance
    vec3  scattered = vec3(0.0);

    for (int i = 0; i < STEPS; i++) {
        if (T < 0.02) break;
        if (t > t1) break;  // capped dt must never march past the slab exit

        vec3 p = ro + rd * t;
        float d = cloudDensity(p);

        if (d > 0.01) {
            float hf = clamp((p.y - uCloudBase) / thickness, 0.0, 1.0);

            // --- sun visibility: Beer + beer-powder (Heckel/Nubis) ---
            float odSun  = lightMarch(p) * KM;
            float beer   = exp(-odSun * SIGMA_L * 60.0);
            float powder = 1.0 - exp(-odSun * SIGMA_L * 120.0);
            float sunVis = mix(beer, beer * powder, 0.5);

            // --- iq directional-derivative dark base (1 extra density tap) ---
            float dl = cloudDensity(p + uSunDir * 280.0);
            float grad = clamp((d - dl) * GRAD_GAIN + 0.5, 0.0, 1.0);

            // --- silver-lining rim: bright thin edges looking toward the sun ---
            float silver = pow(beer, 3.0) * pow(max(mu, 0.0), 8.0) * clamp(1.0 - d, 0.0, 1.0);

            // --- ambient sky fill so shadowed bases read dark-grey, not black ---
            vec3 ambTop = mix(vec3(0.42, 0.48, 0.58), vec3(0.10, 0.11, 0.14), uStorm);
            vec3 ambBot = mix(vec3(0.16, 0.18, 0.22), vec3(0.05, 0.055, 0.07), uStorm);
            vec3 ambient = mix(ambBot, ambTop, hf) * (0.4 + 0.6 * grad);

            // --- direct sun in-scatter ---
            vec3 sunLight = sunCol * (phase * sunVis * grad + silver * 2.4);

            // --- lightning: emit into the occluded base/interior where it reads ---
            float baseW = smoothstep(0.40, 0.0, hf);          // lower 40% of slab
            vec3 flash = uFlashColor * uFlash * (0.5 + 1.0 * baseW) * d * 2.2;

            vec3 srcCol = sunLight + ambient + flash;

            // --- energy-conserving front-to-back integration (Hillaire/iq) ---
            float sigma   = d * SIGMA_E * dt * KM;
            float sampleT = exp(-sigma);
            scattered += T * srcCol * (1.0 - sampleT);
            T *= sampleT;
        }

        t += dt;
    }

    // Composite clouds over sky; residual transmittance reveals the sky behind.
    vec3 col = sky * T + scattered;

    // Aerial perspective: distant cloud bands dissolve into horizon murk.
    col = mix(col, sky, (1.0 - exp(-t0 * 2.6e-5)) * (0.4 + 0.6 * uStorm));

    return col;
}

// ============================================================================
//  DITHER  (interleaved-gradient noise — asset-free blue-noise substitute)
// ============================================================================
float ign(vec2 px) {
    return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec3 rd = normalize(vWorldDir);

    vec3 sky = stormSky(rd);

    float dither = ign(gl_FragCoord.xy + fract(uTime) * 137.0);
    vec3 col = renderClouds(uCamPos, rd, sky, dither);

    // LINEAR HDR out. uExposure shapes cloud/sky balance before the shared
    // renderer tonemap (ACESFilmic). No inline tonemap / gamma here — that is
    // applied once by three.js because the material is toneMapped:true.
    gl_FragColor = vec4(col * uExposure, 1.0);
}`;

export interface CloudDomeHandle {
  mesh: THREE.Mesh;
  uniforms: {
    uTime: { value: number };
    uStorm: { value: number };
    uFlash: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uCamPos: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uFlashColor: { value: THREE.Color };
    uCloudBase: { value: number };
    uCloudTop: { value: number };
    uCoverage: { value: number };
    uDensityMul: { value: number };
    uExposure: { value: number };
  };
}

/** Build the cloud-sky dome. Radius is cosmetic (the slab is real world metres). */
export function makeCloudDome(radius: number): CloudDomeHandle {
  const uniforms = {
    uTime: { value: 0 },
    uStorm: { value: 0 },
    uFlash: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.35, 0.22, 0.3).normalize() },
    uCamPos: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uFlashColor: { value: new THREE.Color(0.55, 0.65, 1.0) },
    uCloudBase: { value: 1800 },
    uCloudTop: { value: 5200 },
    uCoverage: { value: 0 },
    uDensityMul: { value: 1.2 },
    uExposure: { value: 0.9 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: CLOUD_DOME_VERT,
    fragmentShader: CLOUD_DOME_FRAG,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    // Rendered into a half-res HDR target (linear); the full-res blit quad that
    // samples it re-applies the renderer tonemap once, so the dome stays linear.
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.renderOrder = -1000; // background: draw first, behind everything
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uniforms };
}
