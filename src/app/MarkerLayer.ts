import * as THREE from 'three';
import type { Heightmap } from '../geo/heightmap';
import { lonLatToLocalMeters } from '../geo/projection';
import { POINTS_OF_INTEREST } from '../geo/places';
import { createPin } from '../render/PlaceMarker';
import { sampleElevation } from './terrainSampling';

interface Marker {
  object: THREE.Group | null;
  head: THREE.Object3D | null;
  label: HTMLDivElement;
  leader: HTMLDivElement | null;
  name: string;
  district: boolean;
  worldFallback: THREE.Vector3;
}

interface ScreenSize {
  w: number;
  h: number;
}

const MARKER_ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];

/**
 * Points-of-interest pins and district outlines drawn over the terrain, with
 * HTML labels that track each anchor in screen space (and turn into an
 * edge-of-screen arrow when their target is off-camera).
 */
export class MarkerLayer {
  private markers: Marker[] = [];
  private readonly tmpVec = new THREE.Vector3();

  constructor(private readonly group: THREE.Group) {}

  build(hm: Heightmap): void {
    const half = hm.sizeMeters / 2;
    const midElev = (hm.min + hm.max) / 2;
    for (const poi of POINTS_OF_INTEREST) {
      const [mx, my] = lonLatToLocalMeters(hm.center, poi.lon, poi.lat);
      if (Math.hypot(mx, my) > 25000) continue; // only mark places near this area

      let object: THREE.Group | null = null;
      let head: THREE.Object3D | null = null;
      let fallback = new THREE.Vector3(mx, midElev, -my);
      const inBounds = Math.abs(mx) <= half && Math.abs(my) <= half;
      if (poi.polygon && inBounds) {
        const poly = this.buildDistrictPolygon(hm, poi.polygon);
        this.group.add(poly.group);
        object = poly.group;
        head = poly.anchor;
        fallback = poly.anchor.position.clone();
      } else if (inBounds) {
        const u = mx / hm.sizeMeters + 0.5;
        const v = my / hm.sizeMeters + 0.5;
        const pin = createPin(hm.sizeMeters);
        pin.group.position.set(mx, sampleElevation(hm, u, v), -my);
        this.group.add(pin.group);
        object = pin.group;
        head = pin.head;
      }

      const district = !!(poi.polygon && inBounds);
      const label = document.createElement('div');
      let leader: HTMLDivElement | null = null;
      if (district) {
        label.className = 'poi-district';
        label.innerHTML = '<span class="note">♪</span><span class="nm"></span>';
        (label.querySelector('.nm') as HTMLElement).textContent = poi.label;
        leader = document.createElement('div');
        leader.className = 'poi-leader';
        document.body.appendChild(leader);
      } else {
        label.className = 'poi-label';
      }
      document.body.appendChild(label);
      this.markers.push({ object, head, label, leader, name: poi.label, district, worldFallback: fallback });
    }
  }

  /** A boundary outline + faint fill draped on the terrain for a district POI. */
  private buildDistrictPolygon(hm: Heightmap, polygon: Array<[number, number]>):
    { group: THREE.Group; anchor: THREE.Object3D } {
    const size = hm.sizeMeters;
    const lift = size * 0.002;
    const pts: THREE.Vector3[] = [];
    let cx = 0;
    let cz = 0;
    let cy = 0;
    for (const [lat, lon] of polygon) {
      const [mx, my] = lonLatToLocalMeters(hm.center, lon, lat);
      const u = THREE.MathUtils.clamp(mx / size + 0.5, 0, 1);
      const v = THREE.MathUtils.clamp(my / size + 0.5, 0, 1);
      const y = sampleElevation(hm, u, v) + lift;
      pts.push(new THREE.Vector3(mx, y, -my));
      cx += mx; cz += -my; cy += y;
    }
    const n = polygon.length;
    cx /= n; cz /= n; cy /= n;

    const group = new THREE.Group();
    group.frustumCulled = false;

    // faint fill (fan from centroid)
    const fillVerts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      fillVerts.push(cx, cy, cz, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3));
    const fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: 0xe5443a,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    fill.renderOrder = 5;

    // glowing neon boundary as a soft-edged ribbon (HDR-bright → catches bloom)
    const w = size * 0.003;
    const rg: number[] = [];
    const ra: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const d = b.clone().sub(a); d.y = 0;
      if (d.lengthSq() < 1e-6) continue;
      d.normalize();
      const nrm = new THREE.Vector3(-d.z, 0, d.x);
      const y = (a.y + b.y) * 0.5 + lift * 2.0;
      const a2 = a.clone().addScaledVector(d, -w);
      const b2 = b.clone().addScaledVector(d, w);
      const aL = a2.clone().addScaledVector(nrm, -w); aL.y = y;
      const aR = a2.clone().addScaledVector(nrm, w); aR.y = y;
      const bR = b2.clone().addScaledVector(nrm, w); bR.y = y;
      const bL = b2.clone().addScaledVector(nrm, -w); bL.y = y;
      rg.push(aL.x, aL.y, aL.z, aR.x, aR.y, aR.z, bR.x, bR.y, bR.z,
        aL.x, aL.y, aL.z, bR.x, bR.y, bR.z, bL.x, bL.y, bL.z);
      ra.push(-1, 1, 1, -1, 1, -1);
    }
    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(rg, 3));
    ribbonGeo.setAttribute('aAcross', new THREE.Float32BufferAttribute(ra, 1));
    const ribbon = new THREE.Mesh(ribbonGeo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(5.0, 0.5, 0.35) } },
      vertexShader: `attribute float aAcross; varying float vA;
        void main(){ vA = aAcross; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `precision highp float; uniform vec3 uColor; varying float vA;
        void main(){ float core = exp(-vA * vA * 4.0); gl_FragColor = vec4(uColor * core, core); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    ribbon.renderOrder = 6;

    // glowing dot at the centroid (the label anchors to it)
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.004, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(6.0, 0.7, 0.45) }),
    );
    dot.position.set(cx, cy + lift * 3.0, cz);
    dot.renderOrder = 7;

    group.add(fill, ribbon, dot);
    return { group, anchor: dot };
  }

  clear(): void {
    for (const m of this.markers) {
      if (m.object) {
        this.group.remove(m.object);
        m.object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) (mesh.material as THREE.Material).dispose();
        });
      }
      m.label.remove();
      m.leader?.remove();
    }
    this.markers = [];
  }

  update(camera: THREE.Camera): void {
    if (!this.markers.length) return;
    const view: ScreenSize = { w: window.innerWidth, h: window.innerHeight };
    for (const m of this.markers) {
      if (m.head) m.head.getWorldPosition(this.tmpVec);
      else this.tmpVec.copy(m.worldFallback);
      this.tmpVec.project(camera);

      const behind = this.tmpVec.z > 1;
      const onScreen = !behind && Math.abs(this.tmpVec.x) <= 1 && Math.abs(this.tmpVec.y) <= 1;

      if (m.district) this.placeDistrict(m, onScreen, view);
      else this.placePin(m, onScreen, behind, view);
    }
  }

  private placeDistrict(m: Marker, onScreen: boolean, view: ScreenSize): void {
    if (!onScreen) {
      m.label.style.display = 'none';
      if (m.leader) m.leader.style.display = 'none';
      return;
    }
    const dotX = (this.tmpVec.x * 0.5 + 0.5) * view.w;
    const dotY = (-this.tmpVec.y * 0.5 + 0.5) * view.h;
    const labelX = dotX + 38;
    const labelY = dotY - 76;
    m.label.style.display = 'flex';
    m.label.style.transform = 'translate(0, -100%)';
    m.label.style.left = `${labelX}px`;
    m.label.style.top = `${labelY}px`;
    if (m.leader) {
      const dx = labelX - dotX;
      const dy = labelY - dotY;
      m.leader.style.display = 'block';
      m.leader.style.left = `${dotX}px`;
      m.leader.style.top = `${dotY}px`;
      m.leader.style.width = `${Math.hypot(dx, dy)}px`;
      m.leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  private placePin(m: Marker, onScreen: boolean, behind: boolean, view: ScreenSize): void {
    m.label.style.display = 'block';
    if (onScreen) {
      m.label.textContent = m.name;
      m.label.style.transform = 'translate(-50%, -130%)';
      m.label.style.left = `${(this.tmpVec.x * 0.5 + 0.5) * view.w}px`;
      m.label.style.top = `${(-this.tmpVec.y * 0.5 + 0.5) * view.h}px`;
      return;
    }
    let bx = this.tmpVec.x;
    let by = this.tmpVec.y;
    if (behind) { bx = -bx; by = -by; }
    const mag = Math.max(Math.abs(bx), Math.abs(by), 1e-3);
    bx /= mag;
    by /= mag;
    const angle = Math.atan2(by, bx);
    const arrow = MARKER_ARROWS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
    m.label.textContent = `${m.name} ${arrow}`;
    m.label.style.transform = 'translate(-50%, -50%)';
    // keep clear of the address bar (top-left) and the control panel (right).
    m.label.style.left = `${THREE.MathUtils.clamp((bx * 0.5 + 0.5) * view.w, 20, view.w - 340)}px`;
    m.label.style.top = `${THREE.MathUtils.clamp((-by * 0.5 + 0.5) * view.h, 100, view.h - 40)}px`;
  }
}
