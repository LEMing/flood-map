import * as THREE from 'three';

// A precomputed, scrubbable storm: the simulation is run ahead and its water
// state (rgba = depth, maxDepth, velX, velY) is snapshotted into frames, which a
// time slider then plays back without recomputing — a "calculated scene".
export class Timeline {
  private frames: Float32Array[] = [];
  private times: number[] = []; // simulated seconds per frame
  tex: THREE.DataTexture;
  computing = false;
  progress = 0; // 0..1 while precomputing

  constructor(N: number) {
    this.tex = makeTex(N);
  }

  /** Resize the scrub texture to the capture grid (video downsamples to <N). */
  configure(captureN: number): void {
    if (this.tex.image.width === captureN) return;
    this.tex.dispose();
    this.tex = makeTex(captureN);
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

  /** Linearly interpolate between the two nearest captured frames into the scrub
   *  texture — lets a coarse 24–72-frame precompute play back smoothly across
   *  the hundreds of frames a 30 s video needs (no per-playback-frame storage). */
  sampleAt(pos: number): { time: number } | null {
    const n = this.frames.length;
    if (!n) return null;
    const out = this.tex.image.data as Float32Array;
    if (n === 1) {
      out.set(this.frames[0]);
      this.tex.needsUpdate = true;
      return { time: this.times[0] };
    }
    const x = THREE.MathUtils.clamp(pos, 0, 1) * (n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = x - i0;
    const a = this.frames[i0];
    const b = this.frames[i1];
    for (let k = 0; k < out.length; k++) out[k] = a[k] + (b[k] - a[k]) * f;
    this.tex.needsUpdate = true;
    return { time: this.times[i0] + (this.times[i1] - this.times[i0]) * f };
  }

  dispose(): void {
    this.tex.dispose();
    this.frames = [];
    this.times = [];
  }
}

function makeTex(n: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Float32Array(n * n * 4), n, n, THREE.RGBAFormat, THREE.FloatType,
  );
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
