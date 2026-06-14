import * as THREE from 'three';
import type { Params } from '../config';

const vertexShader = /* glsl */ `
  uniform sampler2D depthTex;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vDepth = texture2D(depthTex, uv).x;
    vec3 p = position;
    p.y += vDepth + 0.04; // small lift to sit clear of the terrain surface
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float depthColorMax;
  uniform float opacity;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    if (vDepth < 0.02) discard; // hide essentially-dry cells (< 2 cm)
    float t = clamp(vDepth / depthColorMax, 0.0, 1.0);
    vec3 shallow = vec3(0.40, 0.74, 0.92);
    vec3 deep = vec3(0.02, 0.13, 0.42);
    vec3 col = mix(shallow, deep, sqrt(t));

    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    col = mix(col, vec3(0.85, 0.92, 1.0), fres * 0.5);

    float a = clamp(opacity * (0.45 + 0.55 * t) + fres * 0.2, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }
`;

export class WaterMesh {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(geometry: THREE.BufferGeometry, params: Params) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        depthTex: { value: null },
        depthColorMax: { value: params.depthColorMax },
        opacity: { value: params.waterOpacity },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  setDepthTexture(tex: THREE.Texture): void {
    this.material.uniforms.depthTex.value = tex;
  }

  update(params: Params): void {
    this.material.uniforms.depthColorMax.value = params.depthColorMax;
    this.material.uniforms.opacity.value = params.waterOpacity;
  }

  dispose(): void {
    this.material.dispose();
  }
}
