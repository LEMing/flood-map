import * as THREE from 'three';

// Radial-blur light shafts from the sun's screen position, keyed off bright
// (sky / cloud-gap) pixels and added back. r184 has no WebGL god-ray pass
// (the TSL GodraysNode is WebGPU-only), so this is a hand-written ShaderPass.
export const GodRayShader = {
  name: 'GodRayShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.8) },
    uIntensity: { value: 0.0 },
    uDecay: { value: 0.94 },
    uDensity: { value: 0.85 },
    uWeight: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunScreen;
    uniform float uIntensity, uDecay, uDensity, uWeight;
    varying vec2 vUv;
    const int SAMPLES = 32;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity < 0.001) { gl_FragColor = base; return; }
      vec2 dir = (vUv - uSunScreen) * (uDensity / float(SAMPLES));
      vec2 uv = vUv;
      float decay = 1.0;
      vec3 shaft = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        uv -= dir;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float lum = max(s.r, max(s.g, s.b));
        shaft += smoothstep(0.6, 1.0, lum) * s * decay * uWeight;
        decay *= uDecay;
      }
      float edge = 1.0 - smoothstep(0.0, 1.3, distance(vUv, uSunScreen));
      gl_FragColor = base + vec4(shaft * uIntensity * edge * vec3(1.0, 0.93, 0.78), 0.0);
    }
  `,
};
