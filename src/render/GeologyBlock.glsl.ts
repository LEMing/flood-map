// GLSL shader source for GeologyBlock, extracted verbatim so the renderer file
// stays under the max-lines budget. Each const holds the chunk that is injected
// after a three.js #include marker in onBeforeCompile — the runtime shader
// string is assembled in GeologyBlock.ts and is byte-identical to the inline
// version it replaces.

export const VERT_COMMON = /* glsl */ `
          attribute float aYTop; attribute float aMarine; attribute float aSeabed01; attribute float aWtNorm;
          varying float vDepth01; varying float vMarine; varying float vSeabed01; varying float vWtNorm; varying vec3 vWorld; uniform float uH;`;

export const VERT_BEGIN = /* glsl */ `
          vDepth01 = (aYTop - position.y) / max(uH, 1.0);
          vMarine = aMarine; vSeabed01 = aSeabed01; vWtNorm = aWtNorm; vWorld = position;`;

export const ROCK_HELPERS = /* glsl */ `
          varying float vDepth01; varying float vMarine; varying float vSeabed01; varying float vWtNorm; varying vec3 vWorld;
          uniform sampler2D uLandRamp; uniform sampler2D uMarineRamp; uniform vec3 uSeaShallow, uSeaDeep; uniform float uShowWaterTable, uOceanic;
          float gHash(vec3 p){ return fract(sin(dot(floor(p), vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float gNoise(vec3 p){
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          // ---- cinematic rock helpers (constant-loop, procedural, WebGL1/GLSL-ES-1.00 safe) ----
          vec2 gHash2(vec2 p){
            // wrap into a bounded domain first so sin() keeps precision on mediump drivers
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(p) * 43758.5453);
          }
          // IQ fBM on the existing value-noise: gain 0.5, lacunarity 2, per-octave
          // domain rotation kills axis-aligned grid artifacts. Fixed 5 octaves.
          float gFbm(vec3 p){
            float a = 0.5, t = 0.0;
            mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
            for (int i = 0; i < 5; i++){
              t += a * gNoise(p);
              p.xz = R * p.xz;
              p.xy = R * p.xy;
              p *= 2.0;
              a *= 0.5;
            }
            return t;
          }
          // BIPLANAR scalar fBM: project onto the two dominant world planes (IQ),
          // drop the minor axis, blend pow-sharpened weights. Crisp on vertical cut
          // faces where one horizontal axis dominates the normal. freq in 1/metre.
          float biFbm(vec3 p, vec3 an, float freq, float k){
            float gX = gFbm(vec3(p.z, p.y, p.x) * freq); // X-facing wall (z,y)
            float gY = gFbm(vec3(p.x, p.z, p.y) * freq); // top/bottom cut (x,z)
            float gZ = gFbm(vec3(p.x, p.y, p.z) * freq); // Z-facing wall (x,y)
            vec3 w = an;
            float mn = min(an.x, min(an.y, an.z));
            if (an.x <= mn) { w.x = 0.0; }
            else if (an.y <= mn) { w.y = 0.0; }
            else { w.z = 0.0; }
            w = pow(max(w, 0.0), vec3(k));
            w /= max(w.x + w.y + w.z, 1e-4);
            return gX * w.x + gY * w.y + gZ * w.z;
          }
          // IQ two-pass Voronoi -> perpendicular distance to nearest cell BORDER
          // (joints/fractures). Pass1 3x3 finds owner; pass2 5x5 measures wall dist.
          float voroEdge(vec2 x){
            vec2 ip = floor(x), f = fract(x);
            vec2 mr = vec2(0.0), mg = vec2(0.0); float md = 8.0;
            for (int j = -1; j <= 1; j++){
              for (int i = -1; i <= 1; i++){
                vec2 g = vec2(float(i), float(j));
                vec2 r = g + gHash2(ip + g) - f;
                float dd = dot(r, r);
                if (dd < md){ md = dd; mr = r; mg = g; }
              }
            }
            float res = 8.0;
            for (int j = -2; j <= 2; j++){
              for (int i = -2; i <= 2; i++){
                vec2 g = mg + vec2(float(i), float(j));
                vec2 r = g + gHash2(ip + g) - f;
                if (dot(r - mr, r - mr) > 1e-5){
                  res = min(res, dot(0.5 * (mr + r), normalize(r - mr)));
                }
              }
            }
            return res; // ~0 at a fracture wall, grows toward cell interior
          }
          // F1 cell distance + owner-cell id, for clasts/nodules (conglomerate).
          // x=clast field; returns vec2(distance, per-clast random id). Single 3x3 pass.
          vec2 voroClast(vec2 x){
            vec2 ip = floor(x), f = fract(x);
            float md = 8.0; vec2 mg = vec2(0.0);
            for (int j = -1; j <= 1; j++){
              for (int i = -1; i <= 1; i++){
                vec2 g = vec2(float(i), float(j));
                vec2 r = g + gHash2(ip + g) - f;
                float dd = dot(r, r);
                if (dd < md){ md = dd; mg = g; }
              }
            }
            return vec2(sqrt(md), gHash2(ip + mg).x);
          }`;

export const ROCK_BLOCK = /* glsl */ `
          float d = clamp(vDepth01, 0.0, 1.0);
          vec3 landC = texture2D(uLandRamp, vec2(0.5, d)).rgb;
          // water table: a phreatic surface that meets sea level at the coast and
          // rises inland (depth carried per-column in aWtNorm), not a flat band.
          if (uShowWaterTable > 0.5 && vMarine < 0.5 && abs(d - vWtNorm) < 0.006) {
            landC = mix(landC, vec3(0.25, 0.71, 0.88), 0.85);
          }
          vec3 marineC; float water = 0.0;
          if (d < vSeabed01) {
            float wt = vSeabed01 > 1e-4 ? d / vSeabed01 : 0.0;
            marineC = mix(uSeaShallow, uSeaDeep, wt); water = 1.0;
          } else if (uOceanic > 0.5) {
            // genuinely oceanic cell: oceanic crust below the seabed
            float bd = (d - vSeabed01) / max(1e-3, 1.0 - vSeabed01);
            marineC = texture2D(uMarineRamp, vec2(0.5, clamp(bd, 0.0, 1.0))).rgb;
          } else {
            // continental shelf under coastal water: same rock column as the land
            marineC = landC;
          }
          diffuseColor.rgb = mix(landC, marineC, vMarine);
          // rock grain + faint horizontal laminae so sediment reads as sediment, not a flat slab
          float solid = (vMarine > 0.5 && water > 0.5) ? 0.0 : 1.0;
          // ============================================================
          //  CINEMATIC PROCEDURAL ROCK STRATA  (replaces grain/lam/lambert)
          //  biplanar albedo + eroded bedding + fractures + fake-PBR relief
          //  reads: vWorld (m), d (0=top..1=bottom), diffuseColor.rgb, solid
          // ============================================================
          vec3  P  = vWorld;                                  // world pos, metres
          vec3  gn = normalize(cross(dFdx(P), dFdy(P)));      // geometric normal
          vec3  an = abs(gn);                                 // biplanar weights

          // --- per-stratum character: hard vs soft beds switch slowly with depth ---
          float hard   = 0.45 + 0.55 * gNoise(vec3(0.0, P.y * 0.07, 0.0));
          float coarse = smoothstep(0.45, 0.66, gNoise(vec3(P.xz * 0.010, d * 6.0)));

          // --- 1. ERODED BEDDING: warp the stratigraphic height so contacts undulate ---
          float warp = biFbm(P, an, 0.012, 3.0) - 0.5;        // horizontal low-freq warp
          float bedY = P.y + 14.0 * warp;                     // ~14 m vertical wander
          float beds = gFbm(vec3(P.x * 0.006, bedY * 0.075, P.z * 0.006)); // bed-to-bed bands
          float lamFreq = mix(0.10, 0.17, d);                 // partings tighten with depth
          float partPhase = (bedY + 1.2 * beds) * lamFreq * 6.2831853;
          float partRaw   = 0.5 - 0.5 * cos(partPhase);
          // Procedural anti-aliasing via screen-space derivatives: MSAA can't fix
          // in-surface shader moiré, so widen the parting seam to ~1px and dissolve
          // laminae as they go sub-pixel on grazing/distant faces.
          float pd       = fwidth(partPhase);
          float pBand    = clamp(0.6 * pd, 0.02, 0.45);
          float parting  = smoothstep(0.86 - pBand, 0.86 + pBand, partRaw)
                         * (1.0 - smoothstep(2.2, 5.0, pd));
          float detail   = 1.0 - smoothstep(0.4, 2.4, length(fwidth(P))); // 1 sharp .. 0 smoothed far

          // --- 2. GRAIN + MINERAL SPECKLE + CLASTS (biplanar albedo enrichment) ---
          float grain  = biFbm(P, an, 0.045, 3.0);            // sandstone tooth
          float quartz = smoothstep(0.80, 0.87, gNoise(P * 9.0));        // bright glints
          float mafic  = smoothstep(0.81, 0.88, gNoise(P * 11.0 + 4.0)); // dark specks
          vec2  clastUV = (an.x >= an.z) ? P.zy : P.xy;       // dominant horizontal plane
          vec2  cl      = voroClast(clastUV * 0.55);          // ~1.8 m pebbles
          float clastH  = (1.0 - smoothstep(0.18, 0.55, cl.x)) * coarse;
          float clastId = cl.y - 0.5;                         // per-pebble hue jitter
          float colVar   = gNoise(P * 0.012) - 0.5;            // intra-layer variation

          // --- 3. FRACTURE / JOINT NETWORK (sparse master joints only — one voronoi
          //        pass; gated by noise so it reads as occasional rock joints, not a web) ---
          vec2  jUV    = clastUV;                             // share the dominant plane
          vec2  jw     = vec2(gNoise(P * 0.02), gNoise(P * 0.02 + 31.4)) - 0.5;
          float jointA = voroEdge((jUV + jw * 10.0) * 0.010); // master joints ~100 m, sparse
          float crack  = 1.0 - smoothstep(0.0, 0.015, jointA);
          crack *= smoothstep(0.40, 0.72, gNoise(P * 0.045)); // only SOME joints open up
          crack *= 0.6 + 0.4 * gNoise(P * 0.3);               // vary width

          // --- 4. COMPOSITE ALBEDO (multiply/mix only -> each stratum keeps its hue) ---
          float strata = 0.74 + 0.50 * beds;                 // stronger bed-to-bed value contrast
          float tooth  = 0.99 + 0.18 * (grain - 0.5) * detail; // grain fades sub-pixel (anti-alias)
          vec3  rock   = diffuseColor.rgb * strata * tooth;
          rock *= 1.0 + 0.10 * colVar;                                       // value jitter
          rock  = mix(rock, rock * vec3(1.05, 0.98, 0.92), 0.5 + 0.5 * colVar); // warm/cool drift
          rock *= 1.0 + 0.22 * clastH * (0.6 + clastId);                    // clasts catch light
          rock *= mix(1.0, 1.65, quartz * detail);                          // quartz speck (AA fade)
          rock *= mix(1.0, 0.48, mafic * detail);                           // mafic speck (AA fade)
          rock  = mix(rock, rock * vec3(0.34, 0.31, 0.35), crack * 0.45);   // dark fractures (subtle)
          rock  = mix(rock, rock * 0.55, parting * 0.85);                   // crisp dark bedding partings

          // --- 5. DETAIL NORMAL: surface-gradient bump from the height field ---
          float gC = grain;                                   // reuse centre grain sample
          float eps = mix(2.4, 0.9, hard);                    // metres; finer on hard beds
          float Hx = biFbm(P + vec3(eps, 0.0, 0.0), an, 0.045, 3.0) - gC;
          float Hz = biFbm(P + vec3(0.0, 0.0, eps), an, 0.045, 3.0) - gC;
          float Hy2 = (0.5 - 0.5 * cos((bedY + eps + 1.2 * beds) * lamFreq * 6.2831853));
          vec3  grad = vec3(Hx + dFdx(crack) * 0.5, (Hy2 - partRaw) * 3.0 + dFdy(crack) * 0.5, Hz);
          vec3  surfGrad = grad - dot(grad, gn) * gn;         // project to tangent plane
          float bumpScale = mix(1.6, 2.6, hard);              // stronger rocky relief
          vec3  N  = normalize(gn - bumpScale * surfGrad);
          N = mix(gn, N, 0.92 * detail);                      // detail normal fades far (anti-alias)

          // --- 6. CAVITY AO: crevices, partings & fractures self-occlude ---
          float H  = beds * 0.6 + grain * 0.25 + clastH * 0.5 - crack * 0.5 - parting * 0.6;
          float ao = mix(0.50, 1.0, smoothstep(0.0, 0.8, H + 0.6));
          ao *= (1.0 - 0.35 * crack) * (1.0 - 0.5 * parting);

          // --- 7. BAKED CINEMATIC RIG (UNLIT material -> immune to scene storm/fog) ---
          vec3  Lkey    = normalize(vec3(0.45, 0.62, 0.55));  // warm raking key
          vec3  Lfill   = vec3(0.0, 1.0, 0.0);                // cool sky fill (straight down)
          vec3  Lbnce   = normalize(vec3(-0.45, 0.0, -0.55)); // warm bounce, opposite key
          vec3  viewish = normalize(vec3(0.0, 0.25, 1.0));    // fixed studio eye
          vec3  cKey  = vec3(1.32, 1.10, 0.84);
          vec3  cSky  = vec3(0.30, 0.40, 0.56);
          vec3  cBnce = vec3(0.42, 0.30, 0.20);
          float key  = clamp(dot(N, Lkey) * 0.5 + 0.5, 0.0, 1.0); key *= key; // half-Lambert
          float sky  = clamp(0.5 + 0.5 * dot(N, Lfill), 0.0, 1.0);
          float bnce = clamp(dot(N, Lbnce), 0.0, 1.0);
          vec3  hVec = normalize(Lkey + viewish);
          float wet  = smoothstep(0.55, 0.92, gFbm(P * 0.02)) * mix(0.2, 1.0, d);
          float spec = pow(clamp(dot(N, hVec), 0.0, 1.0), mix(22.0, 60.0, hard)) * (0.10 + 0.5 * wet);
          float fres = pow(1.0 - clamp(dot(N, viewish), 0.0, 1.0), 4.0) * 0.10;
          vec3  lin  = cKey  * (0.30 + 0.95 * key)
                     + cSky  * sky  * ao
                     + cBnce * bnce * ao * 0.7
                     + cSky  * fres;
          vec3  lit  = rock * lin + spec * cKey;              // spec additive, not albedo-tinted

          // --- 8. DEPTH GRADE: deeper rock darkens, cools, densifies (cross-section convention) ---
          float depthDark = mix(1.0, 0.66, d * d);
          float lum = dot(lit, vec3(0.299, 0.587, 0.114));
          lit = mix(lit, vec3(lum), 0.18 * d);                     // desaturate with depth
          lit = mix(lit, vec3(0.36, 0.37, 0.40) * lum, 0.16 * d);  // tint toward dense grey
          lit *= depthDark;
          lit = clamp(lit, 0.0, 1.0);                              // tame before the S-curve
          lit = mix(lit, lit * lit * (3.0 - 2.0 * lit), 0.16);     // gentle filmic S-curve

          // --- 9. APPLY: rock only; water (solid<0.5) stays exactly as set above ---
          diffuseColor.rgb = mix(diffuseColor.rgb, max(lit, 0.0), solid);`;
