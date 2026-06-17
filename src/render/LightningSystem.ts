import * as THREE from 'three';

const BOLT_CAP = 320; // max line segments in a recursive branching bolt

/**
 * Storm lightning: a flash light + a procedural branching bolt mesh. The flash
 * level (0..1) is returned each frame so the owner can also drive the ambient
 * hemisphere light and the cloud-dome flash uniform from it.
 */
export class LightningSystem {
  private readonly light: THREE.DirectionalLight;
  private readonly bolt: THREE.LineSegments;
  private readonly boltGeo: THREE.BufferGeometry;
  private readonly boltPositions = new Float32Array(BOLT_CAP * 6);

  private flash = 0;
  private flashTimer = 3;
  private boltTime = 0;
  private boltCount = 0;
  private sceneSize = 2000;
  private sceneCenterH = 0;
  private cloudY = 600;

  constructor(scene: THREE.Scene) {
    this.light = new THREE.DirectionalLight(0xdfeaff, 0);
    this.light.position.set(0.2, 1, 0.1);
    scene.add(this.light, this.light.target);

    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.LineSegments(
      this.boltGeo,
      new THREE.LineBasicMaterial({
        color: 0xeaf2ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 5;
    this.bolt.visible = false;
    scene.add(this.bolt);
  }

  /** Aim the flash light and scale the bolts to the freshly built terrain. */
  configure(sceneSize: number, cloudY: number, sceneCenterH: number, target: THREE.Vector3): void {
    this.sceneSize = sceneSize;
    this.cloudY = cloudY;
    this.sceneCenterH = sceneCenterH;
    this.light.position.set(0.2, 1, 0.1).multiplyScalar(sceneSize).add(target);
    this.light.target.position.copy(target);
  }

  /** Kill any active flash/bolt (storm off, or paused). */
  reset(): void {
    this.flash = 0;
    this.light.intensity = 0;
    this.bolt.visible = false;
  }

  /** Advance the flash + bolt animation; returns the current flash level (0..1). */
  update(dt: number): number {
    this.flash = Math.max(0, this.flash - dt * 7);
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) this.triggerFlash();
    this.boltTime -= dt;
    this.light.intensity = this.flash * 2.6;
    this.bolt.visible = this.boltTime > 0;
    (this.bolt.material as THREE.LineBasicMaterial).opacity = Math.min(1, this.boltTime * 6);
    return this.flash;
  }

  private triggerFlash(): void {
    this.flash = 1;
    const doubleStrike = Math.random() < 0.4;
    this.flashTimer = doubleStrike ? 0.11 : 2.5 + Math.random() * 6.5;
    if (Math.random() < 0.75) {
      this.makeBolt();
      this.boltTime = 0.18 + Math.random() * 0.14;
    }
  }

  private makeBolt(): void {
    const s = this.sceneSize;
    const start = new THREE.Vector3((Math.random() - 0.5) * s * 0.5, this.cloudY, (Math.random() - 0.5) * s * 0.5);
    const end = new THREE.Vector3(
      start.x + (Math.random() - 0.5) * s * 0.12, this.sceneCenterH, start.z + (Math.random() - 0.5) * s * 0.12,
    );
    this.boltCount = 0;
    this.genBolt(start, end, 6, s * 0.045);
    this.boltGeo.setDrawRange(0, this.boltCount / 3);
    this.boltGeo.attributes.position.needsUpdate = true;
  }

  /**
   * Recursive midpoint-displacement bolt (procedural-weather skill): each segment
   * splits at a jittered midpoint, with a ~35% chance of forking a dimmer branch.
   * Emits line-segment pairs into boltPositions; bloom turns the bright additive
   * line into a glow, so no separate glow mesh is needed.
   */
  private genBolt(a: THREE.Vector3, b: THREE.Vector3, gen: number, jitter: number): void {
    const buf = this.boltPositions;
    if (gen <= 0 || this.boltCount + 6 > buf.length) {
      buf[this.boltCount++] = a.x; buf[this.boltCount++] = a.y; buf[this.boltCount++] = a.z;
      buf[this.boltCount++] = b.x; buf[this.boltCount++] = b.y; buf[this.boltCount++] = b.z;
      return;
    }
    const t = 0.4 + Math.random() * 0.2;
    const mid = new THREE.Vector3(
      a.x + (b.x - a.x) * t + (Math.random() - 0.5) * jitter,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t + (Math.random() - 0.5) * jitter,
    );
    this.genBolt(a, mid, gen - 1, jitter * 0.6);
    this.genBolt(mid, b, gen - 1, jitter * 0.6);
    if (Math.random() < 0.35 && gen > 2) {
      const be = new THREE.Vector3(
        mid.x + (Math.random() - 0.5) * jitter * 2, mid.y - jitter, mid.z + (Math.random() - 0.5) * jitter * 2,
      );
      this.genBolt(mid, be, gen - 2, jitter * 0.4);
    }
  }
}
