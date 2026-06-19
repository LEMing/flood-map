import * as THREE from 'three';
import type { BuildingGeometryData } from '../geo/buildingsGeometry';

// Renders the pre-extruded OSM building massing (footprints triangulated in the
// geo worker — see geo/buildingsGeometry.ts) as one merged mesh: a clean
// white/grey architectural massing with a base→top ambient-occlusion gradient
// (flat-shaded). Sits on the TRUE ground and uses a polygon offset to cover the
// sim's burned building cliffs.
//
// The mesh is parented to the terrain group, which is scaled by the vertical-
// exaggeration slider (group.scale.y = VE). Buildings must seat on that
// exaggerated terrain WITHOUT being stretched VE× taller, so a vertex shader
// divides each vertex's height-above-ground by VE (`aGround` = true ground per
// vertex): the group's later ×VE cancels it, leaving the base on the surface and
// the roof at its real height. One uniform → live, no rebuild on slider drag.

export class BuildingsMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly veUniform = { value: 1 };

  constructor(data: BuildingGeometryData) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(data.color, 3));
    this.geometry.setAttribute('aGround', new THREE.BufferAttribute(data.ground, 1));
    this.geometry.computeBoundingSphere();

    this.material = new THREE.MeshStandardMaterial({
      color: 0xe4e8ee,
      roughness: 0.94,
      metalness: 0.0,
      flatShading: true,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uVE = this.veUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGround;\nuniform float uVE;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y = aGround + (transformed.y - aGround) / uVE;',
        );
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 0;
  }

  setVisible(v: boolean): void { this.mesh.visible = v; }

  /** Match the terrain group's vertical exaggeration so buildings seat on the
   *  surface without being stretched (the shader cancels the group's ×VE). */
  setVerticalExaggeration(ve: number): void {
    this.veUniform.value = ve > 0 ? ve : 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
