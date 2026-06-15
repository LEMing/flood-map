import * as THREE from 'three';

// A precomputed, scrubbable storm: the simulation is run ahead and its water
// state (rgba = depth, maxDepth, velX, velY) is snapshotted into frames, which a
// time slider then plays back without recomputing — a "calculated scene".
export class Timeline {
  private frames: Float32Array[] = [];
  private times: number[] = []; // simulated seconds per frame
  readonly tex: THREE.DataTexture;
  computing = false;
  progress = 0; // 0..1 while precomputing

  constructor(N: number) {
    this.tex = new THREE.DataTexture(
      new Float32Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.FloatType,
    );
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
  }

  begin(): void {
    this.frames = [];
    this.times = [];
    this.computing = true;
    this.progress = 0;
  }

  capture(rgba: Float32Array, simTimeSec: number): void {
    this.frames.push(rgba.slice());
    this.times.push(simTimeSec);
  }

  finish(): void {
    this.computing = false;
    this.progress = 1;
  }

  get count(): number {
    return this.frames.length;
  }

  get ready(): boolean {
    return !this.computing && this.frames.length > 1;
  }

  indexAt(pos: number): number {
    if (this.frames.length === 0) return 0;
    return Math.round(THREE.MathUtils.clamp(pos, 0, 1) * (this.frames.length - 1));
  }

  /** Upload the frame at normalized position to the scrub texture; returns it. */
  showAt(pos: number): { rgba: Float32Array; time: number } | null {
    if (!this.frames.length) return null;
    const i = this.indexAt(pos);
    const rgba = this.frames[i];
    (this.tex.image.data as Float32Array).set(rgba);
    this.tex.needsUpdate = true;
    return { rgba, time: this.times[i] };
  }

  dispose(): void {
    this.tex.dispose();
    this.frames = [];
    this.times = [];
  }
}
