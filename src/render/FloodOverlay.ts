import * as THREE from 'three';
import type { Params } from '../config';

// A bold, lighting-independent flood-extent layer: where the sim has water it
// draws a high-contrast depth ramp (white shallow → cyan → blue deep) on a
// relief grid, so flooded areas are unambiguous even at a few cm depth — unlike
// the realistic water shader which goes transparent in the shallows.
const vertexShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uWater;
  uniform sampler2D uHeightTex;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vDepth = max(texture2D(uWater, uv).x, 0.0);
    float h = texture2D(uHeightTex, uv).x;
    vec3 p = position;
    p.y = h + vDepth + 0.06;     // ride just above the water surface
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uOpacity, uDepthMax, uGrid, uGridSize;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    if (vDepth < 0.01) discard;
    float t = clamp(vDepth / uDepthMax, 0.0, 1.0);
    vec3 shallow = vec3(0.92, 0.97, 1.0);
    vec3 mid = vec3(0.20, 0.72, 0.95);
    vec3 deep = vec3(0.04, 0.22, 0.70);
    vec3 col = t < 0.5 ? mix(shallow, mid, t * 2.0) : mix(mid, deep, (t - 0.5) * 2.0);
    if (uGrid > 0.5) {
      vec2 c = vWorld.xz / uGridSize;
      vec2 gl = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), 1e-4);
      float line = 1.0 - min(min(gl.x, gl.y), 1.0);
      col = mix(col, vec3(0.02, 0.06, 0.15), line * 0.55);
    }
    float a = uOpacity * smoothstep(0.0, 0.04, vDepth); // readable from a few cm
    gl_FragColor = vec4(col, a);
  }
`;

export class FloodOverlay {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(geometry: THREE.BufferGeometry, heightTex: THREE.Texture, sizeMeters: number, params: Params) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uWater: { value: null },
        uHeightTex: { value: heightTex },
        uOpacity: { value: 0.6 },
        uDepthMax: { value: params.depthColorMax },
        uGrid: { value: params.floodGrid ? 1 : 0 },
        uGridSize: { value: Math.max(25, sizeMeters / 25) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = params.floodOverlay;
  }

  setDepthTexture(tex: THREE.Texture): void {
    this.material.uniforms.uWater.value = tex;
  }

  update(params: Params): void {
    this.mesh.visible = params.floodOverlay;
    this.material.uniforms.uDepthMax.value = params.depthColorMax;
    this.material.uniforms.uGrid.value = params.floodGrid ? 1 : 0;
  }

  dispose(): void {
    this.material.dispose();
  }
}
