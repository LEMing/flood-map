import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import { localMetersToLonLat } from '../geo/projection';
import { t } from '../i18n';
import { sampleElevation, sampleDepth } from './terrainSampling';

/** What the controller needs from the app to map pointer events onto the world. */
export interface PointerHost {
  readonly camera: THREE.Camera;
  readonly dom: HTMLElement;
  getTerrainMesh(): THREE.Mesh | undefined;
  getHeightmap(): Heightmap | undefined;
  getReadback(): Float32Array | undefined;
}

/**
 * Pointer interaction over the canvas: a throttled hover readout of the cell
 * under the cursor (elevation, water depth, lat/lon).
 */
export class PointerController {
  private readonly ndc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private inside = false;
  private clientX = 0;
  private clientY = 0;
  private sinceRaycast = 0;
  private readonly readout = document.getElementById('readout') as HTMLDivElement | null;

  constructor(private readonly host: PointerHost) {
    const dom = host.dom;
    dom.addEventListener('pointermove', (e) => {
      const rect = dom.getBoundingClientRect();
      this.ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.inside = true;
    });
    dom.addEventListener('pointerleave', () => {
      this.inside = false;
      if (this.readout) this.readout.style.display = 'none';
    });
  }

  private pickUv(clientX: number, clientY: number): { u: number; v: number; point: THREE.Vector3 } | null {
    const terrain = this.host.getTerrainMesh();
    const hm = this.host.getHeightmap();
    if (!terrain || !hm) return null;
    const rect = this.host.dom.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.host.camera);
    const hit = this.raycaster.intersectObject(terrain, false)[0];
    if (!hit) return null;
    const size = hm.sizeMeters;
    const u = THREE.MathUtils.clamp(hit.point.x / size + 0.5, 0, 1);
    const v = THREE.MathUtils.clamp(0.5 - hit.point.z / size, 0, 1);
    return { u, v, point: hit.point };
  }

  /** Throttled hover readout; raycasts at most every 0.1s while inside the canvas. */
  update(dt: number): void {
    const hm = this.host.getHeightmap();
    if (!this.readout || !this.inside || !this.host.getTerrainMesh() || !hm) return;
    this.sinceRaycast += dt;
    if (this.sinceRaycast < 0.1) return;
    this.sinceRaycast = 0;

    const pick = this.pickUv(this.clientX, this.clientY);
    if (!pick) {
      this.readout.style.display = 'none';
      return;
    }
    const elev = sampleElevation(hm, pick.u, pick.v);
    const readback = this.host.getReadback();
    const depth = readback ? sampleDepth(readback, hm.N, pick.u, pick.v) : 0;
    const [lon, lat] = localMetersToLonLat(hm.center, pick.point.x, -pick.point.z);

    const water = depth > 0.01 ? `  ·  ${t('readout.water')} ${depth.toFixed(2)} m` : '';
    this.readout.textContent = `${t('readout.elev')} ${elev.toFixed(1)} m${water}  ·  ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    this.readout.style.display = 'block';
    this.readout.style.left = `${this.clientX + 14}px`;
    this.readout.style.top = `${this.clientY + 14}px`;
  }
}
