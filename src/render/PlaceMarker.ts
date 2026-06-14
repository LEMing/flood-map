import * as THREE from 'three';

// A simple unlit pin (pole + head) that stays visible against dark/storm
// imagery. Sized relative to the map so it reads at any scale.
export function createPin(sizeMeters: number): { group: THREE.Group; head: THREE.Mesh } {
  const poleHeight = sizeMeters * 0.05;
  const headRadius = sizeMeters * 0.014;
  const material = new THREE.MeshBasicMaterial({ color: 0xe5443a });

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(sizeMeters * 0.0035, sizeMeters * 0.0035, poleHeight, 8),
    material,
  );
  pole.position.y = poleHeight / 2;

  const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 16, 12), material);
  head.position.y = poleHeight + headRadius * 0.4;

  const group = new THREE.Group();
  group.add(pole, head);
  group.renderOrder = 6;
  return { group, head };
}
