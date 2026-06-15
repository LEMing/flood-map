import * as THREE from 'three';
import type { Params } from '../config';
import type { Heightmap } from '../geo/heightmap';

const MAX_DROPS = 9000;

// Rain as instanced, camera-facing streak billboards stretched along the fall
// velocity (screen-space motion blur), with a soft comet profile (bright leading
// head → fading tail, Gaussian across width) and per-drop size/speed/brightness
// variation for depth. Lives under the terrain group; animated by wall-clock time
// so it stays alive when the sim is paused, and clipped to the rain footprint.
export class Rain {
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly size: number;

  constructor(hm: Heightmap) {
    this.size = hm.sizeMeters;
    const topY = hm.max + Math.max(300, hm.sizeMeters * 0.8);
    const fallRange = topY - (hm.min - 10);

    // base quad: x in [-0.5,0.5] (width), y in [0,1] (0 = tail, 1 = leading head)
    const quad = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]);
    const index = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const offset = new Float32Array(MAX_DROPS * 2);
    const phase = new Float32Array(MAX_DROPS);
    const rand = new Float32Array(MAX_DROPS);
    for (let i = 0; i < MAX_DROPS; i++) {
      offset[i * 2] = (Math.random() - 0.5) * this.size;
      offset[i * 2 + 1] = (Math.random() - 0.5) * this.size;
      phase[i] = Math.random();
      rand[i] = Math.random();
    }

    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offset, 2));
    this.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.geometry.setAttribute('instanceRand', new THREE.InstancedBufferAttribute(rand, 1));
    this.geometry.instanceCount = MAX_DROPS;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTopY: { value: topY },
        uFallRange: { value: fallRange },
        uSpeed: { value: 95 },
        uStreakLen: { value: 5.0 },
        uWidth: { value: 0.09 },
        uColor: { value: new THREE.Color(0.86, 0.91, 1.0) },
        uFootprintSpot: { value: 0 },
        uSpotCenter: { value: new THREE.Vector2() },
        uSpotRadius: { value: 1e9 },
        uWind: { value: new THREE.Vector2() }, // horizontal drift per metre fallen
      },
      vertexShader: /* glsl */ `
        attribute vec2 instanceOffset;
        attribute float instancePhase;
        attribute float instanceRand;
        uniform float uTime, uTopY, uFallRange, uSpeed, uStreakLen, uWidth, uSpotRadius;
        uniform int uFootprintSpot;
        uniform vec2 uSpotCenter, uWind;
        varying vec2 vCorner;
        varying float vBright;
        void main() {
          vec2 corner = position.xy;
          vCorner = corner;
          float r = instanceRand;
          float speed = uSpeed * (0.7 + 0.6 * r);
          float fallen = mod(uTime * speed + instancePhase * uFallRange, uFallRange);
          vec3 base = vec3(instanceOffset.x, uTopY - fallen, instanceOffset.y);
          base.xz += uWind * fallen;
          if (uFootprintSpot == 1 && distance(base.xz, uSpotCenter) > uSpotRadius) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clip offscreen
            vBright = 0.0;
            return;
          }
          // build a camera-facing quad stretched along the screen-projected fall dir
          vec4 centerView = modelViewMatrix * vec4(base, 1.0);
          vec3 velView = (modelViewMatrix * vec4(uWind.x, -1.0, uWind.y, 0.0)).xyz;
          vec2 dir = normalize(velView.xy + vec2(0.0, -1e-3));
          vec2 perp = vec2(-dir.y, dir.x);
          float size = 0.7 + 0.7 * r;
          float len = uStreakLen * size;
          float wid = uWidth * size;
          centerView.xy += corner.x * wid * perp + (corner.y - 0.5) * len * dir;
          gl_Position = projectionMatrix * centerView;
          // fade in near the top so drops emerge from the cloud ceiling
          vBright = smoothstep(0.0, 0.12 * uFallRange, fallen) * (0.7 + 0.8 * r);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        varying vec2 vCorner;
        varying float vBright;
        void main() {
          if (vBright <= 0.001) discard;
          float across = exp(-vCorner.x * vCorner.x * 8.0);           // soft Gaussian width
          float along = pow(clamp(vCorner.y, 0.0, 1.0), 0.5);         // bright head -> faded tail
          float a = across * along * vBright;
          // a slightly brighter leading head (the drop) without a comet glow
          vec3 col = uColor * (1.0 + 0.3 * smoothstep(0.85, 1.0, vCorner.y) * across);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
  }

  update(params: Params, wallTimeSec: number): void {
    this.object.visible = params.raining;
    if (!params.raining) return;
    const u = this.material.uniforms;
    u.uTime.value = wallTimeSec;
    const spot = params.rainFootprint === 'spot';
    u.uFootprintSpot.value = spot ? 1 : 0;
    (u.uSpotCenter.value as THREE.Vector2).set(
      (params.spotX - 0.5) * this.size,
      (0.5 - params.spotY) * this.size,
    );
    u.uSpotRadius.value = spot ? params.spotRadius * this.size : 1e9;

    const frac = Math.min(1, Math.max(0.1, params.intensityMmPerHr / 200));
    this.geometry.instanceCount = Math.floor(MAX_DROPS * frac);
    u.uStreakLen.value = 4.0 + frac * 4.0; // heavier rain → longer streaks
    u.uSpeed.value = 80 + frac * 50;
    // Wind-driven slant: stronger in storm mode, scaled a bit by intensity.
    const wind = params.storm ? 0.25 : 0.06;
    (u.uWind.value as THREE.Vector2).set(wind * (0.7 + frac), wind * 0.35);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
