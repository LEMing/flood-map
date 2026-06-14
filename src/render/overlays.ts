import * as THREE from 'three';

/**
 * Translucent layer showing the maximum flood extent/level reached so far
 * (reads the green channel of the water texture = max depth).
 */
export class MaxFloodOverlay {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(geometry: THREE.BufferGeometry) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { depthTex: { value: null }, opacity: { value: 0.4 } },
      vertexShader: /* glsl */ `
        uniform sampler2D depthTex;
        varying float vMax;
        void main() {
          vMax = texture2D(depthTex, uv).y;
          vec3 p = position;
          p.y += max(vMax, 0.0) + 0.4;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        varying float vMax;
        void main() {
          if (vMax < 0.02) discard;
          float t = clamp(vMax / 3.0, 0.0, 1.0);
          vec3 col = mix(vec3(0.96, 0.78, 0.25), vec3(0.85, 0.15, 0.10), t);
          gl_FragColor = vec4(col, opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setDepthTexture(tex: THREE.Texture): void {
    this.material.uniforms.depthTex.value = tex;
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** Instanced flow-direction arrows sampling the velocity texture on the GPU. */
export class VelocityField {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(sizeMeters: number, terrainTex: THREE.Texture, arrowsPerSide = 40) {
    const arrow = new Float32Array([0, 0, -0.18, 0, 0, 0.18, 1, 0, 0]);
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.BufferAttribute(arrow, 3));

    const count = arrowsPerSide * arrowsPerSide;
    const aUv = new Float32Array(count * 2);
    let k = 0;
    for (let j = 0; j < arrowsPerSide; j++) {
      for (let i = 0; i < arrowsPerSide; i++) {
        aUv[k++] = (i + 0.5) / arrowsPerSide;
        aUv[k++] = (j + 0.5) / arrowsPerSide;
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 2));
    geo.instanceCount = count;

    const arrowScale = (sizeMeters / arrowsPerSide) * 0.9;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        velTex: { value: null },
        depthTex: { value: null },
        terrainTex: { value: terrainTex },
        uSize: { value: sizeMeters },
        uArrowScale: { value: arrowScale },
        uMagRef: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aUv;
        uniform sampler2D velTex;
        uniform sampler2D depthTex;
        uniform sampler2D terrainTex;
        uniform float uSize;
        uniform float uArrowScale;
        uniform float uMagRef;
        varying float vMag;
        void main() {
          vec2 vel = texture2D(velTex, aUv).zw;
          float depth = texture2D(depthTex, aUv).x;
          vec3 dir = vec3(vel.x, 0.0, -vel.y);
          float mag = length(dir);
          vMag = mag;
          if (depth < 0.01 || mag < 1e-4) {
            gl_Position = vec4(3.0, 3.0, 3.0, 1.0); // clip offscreen
            return;
          }
          dir /= mag;
          float c = dir.x;
          float s = -dir.z;
          float len = uArrowScale * (0.35 + 0.65 * clamp(mag / uMagRef, 0.0, 1.0));
          vec3 l = position * len;
          vec3 rot = vec3(l.x * c + l.z * s, 0.0, -l.x * s + l.z * c);
          float terr = texture2D(terrainTex, aUv).x;
          vec3 baseP = vec3((aUv.x - 0.5) * uSize, terr + depth + 0.5, (0.5 - aUv.y) * uSize);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(baseP + rot, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vMag;
        void main() {
          vec3 col = mix(vec3(0.75, 0.9, 1.0), vec3(0.1, 0.3, 0.95), clamp(vMag * 0.2, 0.0, 1.0));
          gl_FragColor = vec4(col, 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setTextures(velTex: THREE.Texture, depthTex: THREE.Texture): void {
    this.material.uniforms.velTex.value = velTex;
    this.material.uniforms.depthTex.value = depthTex;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
