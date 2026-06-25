import { W, H, type Rect, type WorldSpec } from './LabWorld';

// A flat-city spec in the spirit of Krasnodar: a near-flat plain (only a couple of metres of
// relief — a gentle tilt and one shallow drainage swale) covered by a regular street grid of
// solid building blocks. The point of this lab: on flat ground it is NOT elevation that
// decides the flood — buildings are solid obstacles and the streets are the only conveyance,
// so rain backs up along the grid and pools in the low street corridor. Deterministic.

const BASE_Z = 28; // m — Krasnodar sits ~25–35 m on the Kuban plain

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Near-flat micro-relief: a gentle SW tilt + a shallow valley corridor where streets pool. */
function microRelief(): Float32Array {
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = i / (W - 1);
      const v = j / (H - 1);
      const tilt = -2.2 * u - 0.9 * v; // drains toward the +x/+y corner
      const d = u - v * 0.6 - 0.12; // signed distance from a diagonal axis
      const valley = -1.7 * Math.exp(-(d * d) / (2 * 0.035));
      const ripple = 0.16 * Math.sin(u * 23 + 1.3) * Math.cos(v * 19 + 0.7) + 0.1 * Math.sin(u * 41) * Math.sin(v * 35);
      z[j * W + i] = BASE_Z + tilt + valley + ripple;
    }
  }
  return z;
}

/** Block extents along one axis, separated by 1-cell streets and a wider avenue every 4th. */
function blockSpans(total: number, rng: () => number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let x = 3;
  let k = 0;
  while (x < total - 5) {
    const end = Math.min(total - 3, x + 5 + (rng() < 0.5 ? 0 : 1));
    if (end - x >= 3) out.push([x, end]);
    x = end + (k % 4 === 3 ? 2 : 1); // avenue : side street
    k++;
  }
  return out;
}

export function krasnodarSpec(): WorldSpec {
  const z = microRelief();
  const solid = new Uint8Array(W * H);
  const rects: Rect[] = [];
  const rng = mulberry32(0x4b524e44);
  const xs = blockSpans(W, rng);
  const ys = blockSpans(H, rng);
  for (const [y0, y1] of ys) {
    for (const [x0, x1] of xs) {
      if (rng() < 0.07) continue; // a square / park / vacant lot
      const inset = rng() < 0.25 ? 1 : 0; // occasional setback for variety
      const rx = x0 + inset;
      const ry = y0;
      const rw = x1 - x0 - inset;
      const rh = y1 - y0;
      if (rw < 2 || rh < 2) continue;
      rects.push({ x: rx, y: ry, w: rw, h: rh });
      for (let j = ry; j < ry + rh; j++) for (let i = rx; i < rx + rw; i++) solid[j * W + i] = 1;
    }
  }
  return { z, solid, rects };
}
