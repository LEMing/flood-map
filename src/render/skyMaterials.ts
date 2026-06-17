import * as THREE from 'three';
import { GLSL_FBM } from './glslNoise';

export interface WeatherUniformBlock {
  uTime: THREE.IUniform<number>;
  uCloudDrift: THREE.IUniform<THREE.Vector2>;
  uCloudScale: THREE.IUniform<number>;
  uStorm: THREE.IUniform<number>;
  uCloudShadow: THREE.IUniform<number>;
  uSunScreen: THREE.IUniform<THREE.Vector2>;
  uSunVisible: THREE.IUniform<number>;
}

export function makeSkyGradient(stops: [string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.5, stops[1]);
  grad.addColorStop(1, stops[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeHaze(weather: WeatherUniformBlock): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: weather.uTime,
      uStorm: weather.uStorm,
      uCloudDrift: weather.uCloudDrift,
      uHaze: { value: 0.5 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStorm, uHaze;
      uniform vec2 uCloudDrift;
      varying vec2 vP;
      ${GLSL_FBM}
      void main() {
        // Two drifting, domain-warped fbm layers → rolling volumetric-looking
        // ground-fog wisps (procedural-weather skill) instead of one flat sheet.
        vec2 base = vP * 0.0018;
        vec2 drift = uCloudDrift * uTime;
        float n1 = wFbm(base + drift * 0.4 + wFbm(base * 0.6 + drift * 0.2));
        float n2 = wFbm(base * 2.3 - drift * 0.8);
        float wisp = smoothstep(0.30, 0.74, n1 * 0.68 + n2 * 0.32);
        float edge = 1.0 - smoothstep(0.30, 0.5, length(vP)); // radial fade -> no hard slab edge
        float a = wisp * 0.18 * uStorm * uHaze * edge;
        vec3 col = mix(vec3(0.50, 0.55, 0.62), vec3(0.72, 0.76, 0.82), wisp);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  return mesh;
}

/**
 * Full-screen quad that upscales the half-res linear-HDR cloud target and lets
 * the renderer tonemap it once (toneMapped:true), so the sky matches a full-res
 * dome exactly — only the raymarch resolution drops.
 */
export function makeDomeBlit(tex: THREE.Texture): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex } },
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}
