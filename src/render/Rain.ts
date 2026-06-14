import * as THREE from 'three';
import type { Params } from '../config';
import type { Heightmap } from '../geo/heightmap';

const MAX_DROPS = 6000;

// Falling-rain streaks rendered as GPU-animated line segments. Lives under the
// terrain group so it shares the vertical exaggeration and sits above the
// surface. Animation is driven by wall-clock time (so rain looks alive even
// when the simulation is paused) and falls only within the rain footprint.
export class Rain {
  readonly object: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;
  private readonly size: number;

  constructor(hm: Heightmap) {
    this.size = hm.sizeMeters;
    const topY = hm.max + 150; // metres of rain column above the highest ground
    const fallRange = topY - (hm.min - 10);

    const position = new Float32Array(MAX_DROPS * 2 * 3);
    const aPhase = new Float32Array(MAX_DROPS * 2);
    const aSeg = new Float32Array(MAX_DROPS * 2);
    for (let i = 0; i < MAX_DROPS; i++) {
      const x = (Math.random() - 0.5) * this.size;
      const z = (Math.random() - 0.5) * this.size;
      const phase = Math.random();
      for (let s = 0; s < 2; s++) {
        const k = i * 2 + s;
        position[k * 3] = x;
        position[k * 3 + 2] = z;
        aPhase[k] = phase;
        aSeg[k] = s; // 0 = head, 1 = tail
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geometry.setAttribute('aSeg', new THREE.BufferAttribute(aSeg, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTopY: { value: topY },
        uFallRange: { value: fallRange },
        uSpeed: { value: 95 },
        uStreak: { value: 12 },
        uFootprintSpot: { value: 0 },
        uSpotCenter: { value: new THREE.Vector2() },
        uSpotRadius: { value: 1e9 },
        uWind: { value: new THREE.Vector2() }, // horizontal drift per metre fallen
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSeg;
        uniform float uTime, uTopY, uFallRange, uSpeed, uStreak, uSpotRadius;
        uniform int uFootprintSpot;
        uniform vec2 uSpotCenter, uWind;
        varying float vSeg;
        void main() {
          vec3 p = position;
          if (uFootprintSpot == 1 && distance(p.xz, uSpotCenter) > uSpotRadius) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clip offscreen
            vSeg = 0.0;
            return;
          }
          float t = uTime * uSpeed + aPhase * uFallRange;
          float fallen = mod(t, uFallRange);
          p.xz += uWind * fallen;            // wind pushes drops sideways as they fall
          p.y = uTopY - fallen - aSeg * uStreak;
          p.xz -= uWind * aSeg * uStreak;    // slant the streak along the wind
          vSeg = aSeg;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vSeg;
        void main() {
          gl_FragColor = vec4(0.72, 0.82, 0.96, mix(0.5, 0.04, vSeg));
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.object = new THREE.LineSegments(geometry, this.material);
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

    const frac = Math.min(1, Math.max(0.08, params.intensityMmPerHr / 200));
    this.object.geometry.setDrawRange(0, Math.floor(MAX_DROPS * frac) * 2);
    u.uStreak.value = 8 + frac * 12;
    // Wind-driven slant: stronger in storm mode, scaled a bit by intensity.
    const wind = params.storm ? 0.22 : 0.05;
    (u.uWind.value as THREE.Vector2).set(wind * (0.7 + frac), wind * 0.35);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
