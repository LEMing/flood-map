import * as THREE from 'three';
import { CLOUD_VERT, CLOUD_FRAG } from './CloudDome.glsl';

// Raymarched volumetric cloud DOME — a BackSide sphere recentred on the camera
// each frame. The fragment shader reconstructs the world view ray and marches a
// world-space cloud slab (Nubis-style coverage + height-gradient + Worley
// erosion density, Heckel/Nubis Beer-powder + dual-lobe HG lighting, iq
// front-to-back integration) plus an analytic storm sky, so clouds read as full
// 3D from horizon to zenith. Outputs LINEAR HDR; the renderer's ACES tonemap is
// applied once (toneMapped:true), so do NOT tonemap in the shader.
// Synthesized from iq Clouds, Guerrilla "Nubis", Maxime Heckel and Sebastian Lague.

export interface CloudDomeHandle {
  mesh: THREE.Mesh;
  uniforms: {
    uTime: { value: number };
    uStorm: { value: number };
    uFlash: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uCamPos: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uFlashColor: { value: THREE.Color };
    uCloudBase: { value: number };
    uCloudTop: { value: number };
    uShapeScale: { value: number };
    uCoverage: { value: number };
    uDensityMul: { value: number };
    uExposure: { value: number };
  };
}

/** Build the cloud-sky dome. Radius is cosmetic (the slab is real world metres). */
export function makeCloudDome(radius: number): CloudDomeHandle {
  const uniforms = {
    uTime: { value: 0 },
    uStorm: { value: 0 },
    uFlash: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.35, 0.22, 0.3).normalize() },
    uCamPos: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uFlashColor: { value: new THREE.Color(0.55, 0.65, 1.0) },
    uCloudBase: { value: 1800 },
    uCloudTop: { value: 5200 },
    uShapeScale: { value: 0.0002 },
    uCoverage: { value: 0 },
    uDensityMul: { value: 1.2 },
    uExposure: { value: 0.9 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    // Rendered into a half-res HDR target (linear); the full-res blit quad that
    // samples it re-applies the renderer tonemap once, so the dome stays linear.
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.renderOrder = -1000; // background: draw first, behind everything
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uniforms };
}
