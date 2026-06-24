// Inline GLSL for the WaterMesh shader material. The fragment shader is assembled
// in WaterMesh.ts by splicing GLSL_FBM between WATER_FRAG_HEAD and WATER_FRAG_BODY,
// preserving the original `${GLSL_FBM}` interpolation point.
export const WATER_VERT = /* glsl */ `
  precision highp float;
  uniform sampler2D uWater;
  uniform sampler2D uHeightTex;
  uniform float uMinTerrain;
  uniform float uSkirtDrop;
  #ifdef SKIRT
    attribute float aSkirtT;   // 0 = lip (rides surface), 1 = floor (below seabed)
  #endif
  varying float vDepth;
  varying vec2  vVel;
  varying vec3  vWorld;
  varying vec2  vGridUv;
  varying float vSkirtT;
  void main() {
    vGridUv = uv;
    vec4 w = texture2D(uWater, uv);
    float depth = max(w.x, 0.0);
    float terrainH = texture2D(uHeightTex, uv).x;
    vDepth = depth;
    vVel = w.zw;
    vec3 p = position;
    #ifdef SKIRT
      vSkirtT = aSkirtT;
      float lipY = terrainH + depth;
      float floorY = uMinTerrain - uSkirtDrop;
      p.y = mix(lipY, floorY, aSkirtT);
    #else
      vSkirtT = 0.0;
      p.y = terrainH + depth;
    #endif
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const WATER_FRAG_HEAD = /* glsl */ `
  precision highp float;

  uniform sampler2D uSceneColor;
  uniform sampler2D uSceneDepth;
  uniform vec2  uResolution;
  uniform float uCameraNear, uCameraFar;
  uniform float uTime;
  uniform float uOpacity, uDepthColorMax;
  uniform vec3  uAbsorb, uDeepColor, uTint;
  uniform vec3  uSkyTop, uSkyHorizon, uCloudColor;
  uniform float uCloudReflect;
  uniform vec3  uSunDir, uSunColor;
  uniform float uRefract, uReflect, uRefractAmount, uClarity;
  uniform float uRippleStrength, uFlowScale, uShoreFade;
  uniform float uFoam, uFoamVel, uGlint, uShininess;
  uniform float uShorelineRim;
  // weather / splashes (shared with SceneManager.weatherUniforms where noted)
  uniform float uRainAmount, uSplashCell;
  uniform float uFootprintSpot;
  uniform vec2  uSpotCenter;
  uniform float uSpotRadius;
  uniform float uStorm, uCloudShadow, uCloudScale;
  uniform vec2  uCloudDrift;
  uniform sampler2D uWater;     // sampled in-fragment to smooth the coarse sim grid
  uniform vec2  uTexel;         // 1 / gridResolution

  varying float vDepth;
  varying vec2  vVel;
  varying vec3  vWorld;
  varying vec2  vGridUv;
  varying float vSkirtT;

  `;

export const WATER_FRAG_BODY = /* glsl */ `

  // Tent-filtered depth: dissolves isolated single-cell water (the "droplets" at
  // coarse grids) into continuous water without changing the sim itself.
  float smoothDepth(vec2 uv) {
    float s = 0.0, w = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        float wt = (i == 0 && j == 0) ? 4.0 : ((i == 0 || j == 0) ? 2.0 : 1.0);
        s += wt * max(texture2D(uWater, uv + vec2(float(i), float(j)) * uTexel).x, 0.0);
        w += wt;
      }
    }
    return s / w;
  }

  float viewZ(float d) {                       // non-linear depth [0,1] -> view-space Z (<0)
    float z = d * 2.0 - 1.0;
    return (2.0 * uCameraNear * uCameraFar) / (z * (uCameraFar - uCameraNear) - (uCameraFar + uCameraNear));
  }

  vec3 rippleNormal(vec2 p, vec2 flow, float t) {
    vec2 adv = flow * t * uFlowScale;
    float e = 0.75;
    float sa = 1.0 / 140.0, sb = 1.0 / 47.0;   // two spatial frequencies (cycles/m)
    float hxA = wNoise((p + vec2(e,0.0)) * sa + adv) - wNoise((p - vec2(e,0.0)) * sa + adv);
    float hyA = wNoise((p + vec2(0.0,e)) * sa + adv) - wNoise((p - vec2(0.0,e)) * sa + adv);
    float hxB = wNoise((p + vec2(e,0.0)) * sb - adv*1.7) - wNoise((p - vec2(e,0.0)) * sb - adv*1.7);
    float hyB = wNoise((p + vec2(0.0,e)) * sb - adv*1.7) - wNoise((p - vec2(0.0,e)) * sb - adv*1.7);
    return normalize(vec3(-(0.6*hxA + 0.4*hxB), -(0.6*hyA + 0.4*hyB), 1.0));
  }

  vec3 applySplashes(vec3 N, vec3 worldPos, inout float crestOut) {
    if (uRainAmount < 0.01) return N;
    float foot = 1.0;
    if (uFootprintSpot == 1.0) {
      foot = 1.0 - smoothstep(uSpotRadius * 0.85, uSpotRadius, distance(worldPos.xz, uSpotCenter));
    }
    if (foot < 0.01) return N;
    vec2 cellUv = fract(worldPos.xz / uSplashCell) - 0.5;
    vec2 cellId = floor(worldPos.xz / uSplashCell);
    float bump = 0.0, crest = 0.0;
    for (int j = 0; j < 4; j++) {
      vec2 off = vec2(float(j - (j/2)*2), float(j/2));
      vec2 id = cellId + off;
      float h = wHash(id);
      if (h > 0.35 * uRainAmount) continue;
      vec2 jitter = (vec2(wHash(id + 11.0), wHash(id + 23.0)) - 0.5) * 0.7;
      vec2 center = (off - 0.5) + jitter;
      float dist = length(cellUv - center) * uSplashCell;
      float period = 1.1 + h * 1.3;
      float phase = fract(uTime / period + h);
      float radius = phase * (uSplashCell * 0.9);
      float ring = dist - radius;
      float fade = 1.0 - phase;
      float thin = exp(-ring * ring * 6.0);
      bump += sin(ring * 9.0) * thin * fade;
      crest += smoothstep(0.12, 0.0, abs(ring)) * fade * fade;
    }
    float amp = 0.20 * uRainAmount * foot;
    vec2 grad = (cellUv / max(length(cellUv), 1e-4)) * bump * amp;
    crestOut += crest * uRainAmount * foot * 0.6;
    return normalize(N + vec3(grad.x, 0.0, grad.y));
  }

  void main() {
    // smoothed depth for all the visual terms (kills coarse-grid droplets);
    // the geometry still rides the per-vertex vDepth.
    float sd = smoothDepth(vGridUv);

    vec3 cn = cross(dFdx(vWorld), dFdy(vWorld));
    float cnLen = length(cn);
    vec3 geomN = cnLen > 1e-12 ? cn / cnLen : vec3(0.0, 1.0, 0.0);
    if (geomN.y < 0.0) geomN = -geomN;
    float wallness = 1.0 - clamp(geomN.y, 0.0, 1.0);

    // --- surface normal: ripples advected by the flow field (guarded) ---
    float speed = length(vVel);
    vec2 flowDir = vVel / max(speed, 1e-4);
    vec2 flow = flowDir * min(speed, 4.0);
    float ripAmp = uRippleStrength * (0.5 + 0.5 * clamp(speed / 2.0, 0.0, 1.0));
    ripAmp *= (1.0 - 0.7 * vSkirtT) * smoothstep(0.0, 0.06, sd);
    vec3 nTS = rippleNormal(vWorld.xz, flow, uTime);
    vec3 surfN = normalize(geomN + ripAmp * vec3(nTS.x, 0.0, nTS.y));
    #ifdef SKIRT
      surfN = geomN;
    #endif

    float crest = 0.0;
    surfN = applySplashes(surfN, vWorld, crest);

    vec3 viewDir = normalize(cameraPosition - vWorld);

    // --- screen-space refraction of the submerged bottom ---
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec3 bottomColor;
    if (uRefract > 0.5) {
      vec2 refrOffset = surfN.xz * uRefractAmount * clamp(sd * 0.15, 0.0, 1.0) * (1.0 - 0.7 * uClarity) * (1.0 - 0.85 * vSkirtT);
      vec2 refrUv = clamp(screenUv + refrOffset, vec2(0.001), vec2(0.999));
      float sceneVZ = viewZ(texture2D(uSceneDepth, refrUv).x);
      float fragVZ = viewZ(gl_FragCoord.z);
      if (sceneVZ > fragVZ + abs(fragVZ) * 0.01 + 0.5) refrUv = screenUv;  // reject geometry in front of water
      bottomColor = texture2D(uSceneColor, refrUv).rgb;
    } else {
      bottomColor = texture2D(uSceneColor, screenUv).rgb;
    }

    // --- Beer-Lambert depth absorption ---
    vec3 transmit = exp(-sd * uAbsorb);
    vec3 throughWater = mix(uDeepColor, bottomColor * uTint, transmit);

    // blend in a clear flood-map depth ramp (white shallow -> cyan -> blue deep)
    // so flooded cells stay legible like the overlay, while refraction still shows
    // through and ripples/foam/glint sit on top for realism.
    float dt = clamp(sd / uDepthColorMax, 0.0, 1.0);
    vec3 fShallow = vec3(0.82, 0.94, 1.00);
    vec3 fMid = vec3(0.10, 0.66, 0.96);
    vec3 fDeep = vec3(0.02, 0.30, 0.74);
    vec3 floodTint = dt < 0.5 ? mix(fShallow, fMid, dt * 2.0) : mix(fMid, fDeep, (dt - 0.5) * 2.0);
    throughWater = mix(throughWater, floodTint, uClarity * (1.0 - 0.4 * vSkirtT));

    // --- sky + cloud reflection with fresnel ---
    vec3 reflDir = reflect(-viewDir, surfN);
    float up = clamp(reflDir.y, 0.0, 1.0);
    vec3 skyColor = mix(uSkyHorizon, uSkyTop, pow(up, 0.5));
    float cl = 0.5 + 0.5 * sin(reflDir.x * 8.0 + uTime * 0.05) * sin(reflDir.z * 8.0);
    skyColor = mix(skyColor, uCloudColor, smoothstep(0.6, 0.95, cl) * up * uCloudReflect);
    float f0 = 0.05;
    float fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(viewDir, surfN), 0.0), 5.0);
    fres = mix(fres, 1.0, 0.6 * vSkirtT) * uReflect;
    fres = clamp(fres * 1.4, 0.0, 1.0);          // stronger, more visible sky reflection

    vec3 color = mix(throughWater, skyColor, clamp(fres, 0.0, 1.0));

    // --- foam: shoreline (depth gradient) + fast flow, animated ---
    float foam = 0.0;
    if (uFoam > 0.0) {
      float depthGrad = length(vec2(dFdx(sd), dFdy(sd))) / max(fwidth(length(vWorld.xz)), 1.0);
      float shoreFoam = smoothstep(0.15, 0.6, depthGrad) * smoothstep(0.0, 0.4, sd);
      float flowFoam = smoothstep(uFoamVel, uFoamVel * 3.0, speed) * 0.7;
      float wallFoam = wallness * smoothstep(0.0, 0.3, sd);
      float mask = clamp(shoreFoam + flowFoam + wallFoam, 0.0, 1.0);
      float fn = wNoise(vWorld.xz * 0.5 - flow * uTime * 0.3 + uTime * 0.2);
      foam = mask * smoothstep(0.4, 0.85, fn) * uFoam;
      color = mix(color, vec3(0.95, 0.97, 1.0), clamp(foam, 0.0, 1.0));
    }

    // --- dedicated shoreline rim: a constant saturated band at the depth-gradient edge.
    // Unlike foam this never flickers and is not gated by water quality, so the waterline
    // stays legible over busy imagery even in low mode. ---
    if (uShorelineRim > 0.0) {
      float rimGrad = length(vec2(dFdx(sd), dFdy(sd))) / max(fwidth(length(vWorld.xz)), 1.0);
      float rim = smoothstep(0.08, 0.4, rimGrad) * smoothstep(0.6, 0.25, rimGrad) * smoothstep(0.0, 0.25, sd);
      color = mix(color, vec3(0.10, 0.62, 0.96), rim * uShorelineRim * (1.0 - vSkirtT));
    }

    // --- sun specular glint (uSunColor already scaled by sun brightness) ---
    vec3 halfV = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(surfN, halfV), 0.0), uShininess);
    color += uSunColor * spec * uGlint * 0.5 * (1.0 - 0.5 * vSkirtT);

    // --- rain-splash crest highlight ---
    color += vec3(crest);

    // --- moving cloud shadow (storm) ---
    vec2 sp = vWorld.xz * uCloudScale + uCloudDrift * uTime;
    float clouds = wFbm(sp + wFbm(sp * 0.5));
    float shadow = smoothstep(0.45, 0.85, clouds) * uCloudShadow * uStorm;
    color *= (1.0 - shadow * 0.6);

    // --- alpha: realistic soft shoreline blended toward a fast overlay-like fade by
    // clarity, so flooded cells become visible within a few cm when clarity is up ---
    float wetSoft = smoothstep(0.0, uShoreFade, sd);
    float wetFast = smoothstep(0.0, 0.05, sd);
    float wet = mix(wetSoft, wetFast, uClarity);
    float baseAlpha = uOpacity * (0.65 + 0.35 * dt);
    float alpha = clamp(baseAlpha * wet + fres * 0.2 + foam * 0.5, 0.0, 1.0);
    #ifdef SKIRT
      alpha = clamp(uOpacity * 0.9 + fres * 0.2, 0.0, 1.0);
    #endif
    gl_FragColor = vec4(color, alpha);
  }
`;
