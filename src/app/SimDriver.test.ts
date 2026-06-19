// SimDriver's CPU orchestration: the CFL-substepped live stepping (the clamp
// that keeps the shallow-water sim from going unstable / NaN) and the until-dry
// precompute self-termination. Driven through a recording mock FloodSimulation —
// no GPU. Casts use `any`, which the test eslint override permits.
import { describe, it, expect, vi } from 'vitest';
import { SimDriver } from './SimDriver';
import { Timeline } from '../sim/Timeline';
import { DEFAULT_PARAMS, type Params } from '../config';
import { INITIAL_STATS } from '../ui/stats';
import type { FloodSimulation } from '../sim/FloodSimulation';
import type { Heightmap } from '../geo/heightmap';

interface MockSim {
  N: number;
  cellSize: number;
  steps: number[];
  step: ReturnType<typeof vi.fn>;
  readWater: (buf: Float32Array) => void;
}

function mockSim(N: number, cellSize: number): MockSim {
  const steps: number[] = [];
  return {
    N,
    cellSize,
    steps,
    step: vi.fn((dt: number) => steps.push(dt)),
    readWater: (buf: Float32Array) => buf.fill(0), // dry → observedMaxDepth stays 1
    setRainRateMmPerHr: vi.fn(),
    updateParams: vi.fn(),
    reset: vi.fn(),
    requestFill: vi.fn(),
    requestInject: vi.fn(),
    setSurface: vi.fn(),
    pollReadback: vi.fn(() => false),
    requestReadback: vi.fn(() => false), // no fence → sync readWater path
    waterTexture: {},
    dispose: vi.fn(),
  } as unknown as MockSim;
}

function makeDriver(sim: MockSim, over: Partial<Params> = {}): SimDriver {
  const params: Params = { ...DEFAULT_PARAMS, ...over };
  const hooks = { refreshPanel: vi.fn(), syncTextures: vi.fn(), fps: () => 60 };
  const d = new SimDriver(params, { ...INITIAL_STATS }, hooks);
  const hm = {
    data: new Float32Array(sim.N * sim.N), N: sim.N, sizeMeters: sim.cellSize * sim.N,
    center: { lat: 0, lon: 0 }, min: 0, max: 10, synthetic: false,
  } as Heightmap;
  d.setWorld(sim as unknown as FloodSimulation, new Timeline(sim.N), hm);
  return d;
}

const cfl = (cellSize: number, refDepth = 1, g = 9.81): number => (0.45 * cellSize) / Math.sqrt(g * refDepth);

describe('SimDriver — CFL substepping (live)', () => {
  it('never steps the sim with dt above the CFL limit and consumes the full window', () => {
    const sim = mockSim(8, 5);
    const d = makeDriver(sim, { running: true, floodLevelLive: false, raining: false, timeScale: 180, substeps: 4 });
    d.tick(0.016); // simSeconds = 0.016 * 180 = 2.88
    const cflMax = cfl(5);
    expect(sim.steps.length).toBeGreaterThan(0);
    for (const dt of sim.steps) expect(dt).toBeLessThanOrEqual(cflMax + 1e-9);
    expect(sim.steps.reduce((a, b) => a + b, 0)).toBeCloseTo(2.88, 2); // whole window simulated
    expect(d.simTimeSec).toBeCloseTo(2.88, 2);
  });

  it('caps the substeps per frame when the CFL limit is tiny (fine grid)', () => {
    const sim = mockSim(8, 0.1); // tiny cell → tiny cflMax → would need thousands of substeps
    const d = makeDriver(sim, { running: true, floodLevelLive: false, raining: false, timeScale: 600, substeps: 4 });
    d.tick(0.05); // simSeconds = 30
    expect(sim.steps.length).toBe(48); // MAX_STEPS_PER_FRAME
    const cflMax = cfl(0.1);
    for (const dt of sim.steps) expect(dt).toBeLessThanOrEqual(cflMax + 1e-9);
    expect(d.simTimeSec).toBeLessThan(30); // window not fully consumed under the cap
  });

  it('does not step a frozen (paused) sim', () => {
    const sim = mockSim(8, 5);
    const d = makeDriver(sim, { running: false, floodLevelLive: false });
    d.tick(0.016);
    expect(sim.steps.length).toBe(0);
  });
});

describe('SimDriver — until-dry precompute', () => {
  it('self-terminates the timeline once the flood has fully drained', () => {
    const sim = mockSim(8, 5);
    let call = 0;
    // Flood pools (depth 3) through the storm, then recedes to dry.
    sim.readWater = (buf: Float32Array) => {
      const depth = call++ < 30 ? 3 : 0;
      for (let i = 0; i < buf.length; i += 4) { buf[i] = depth; buf[i + 1] = Math.max(buf[i + 1], depth); }
    };
    const d = makeDriver(sim, { stormType: 'cloudburst' });
    d.beginPrecompute({ untilDry: true });
    expect(d.mode).toBe('computing');

    let frames = 0;
    while (!d.timelineReady && frames++ < 5000) d.tick(0.016);

    expect(d.timelineReady).toBe(true); // it actually finished
    expect(d.mode).toBe('scrub'); // finishPrecompute switched to playback
    // Each tick captures one frame; terminating well under the videoFrameBudget cap
    // (and the 5000 guard) means it finished via dry-detection, not a hard cap.
    expect(frames).toBeLessThan(55);
  });
});
