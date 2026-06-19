import type * as THREE from 'three';

/** Sun / sky / camera fields shared by every per-frame water + sea update.
 *  WaterFrame and SeaFrame each extend this with one mesh-specific field;
 *  SceneManager.frameBasis() produces it once per frame. */
export interface FrameBasis {
  resolution: THREE.Vector2;
  cameraNear: number;
  cameraFar: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
}
