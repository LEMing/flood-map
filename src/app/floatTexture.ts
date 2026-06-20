import * as THREE from 'three';

/**
 * Create or refresh an N×N RGBA-float `DataTexture` (NearestFilter) from `data`.
 * Reuses the existing texture's buffer when present so live per-cell field updates
 * (surface, sewer) don't churn GPU allocations.
 */
export function upsertFloatTexture(
  existing: THREE.DataTexture | undefined, data: Float32Array, N: number,
): THREE.DataTexture {
  if (existing) {
    (existing.image.data as Float32Array).set(data);
    existing.needsUpdate = true;
    return existing;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
