// Shared GLSL value-noise + fbm chunk, injected into the water, terrain wet-look
// and haze shaders so they stay in sync (one definition, no drift).
export const GLSL_FBM = /* glsl */ `
  float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
               mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float wFbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * wNoise(p); p *= 2.0; a *= 0.5; }
    return v;
  }
`;
