// Non-blocking GPU stats readback scheduler: kick a readback once the interval
// elapses, fire onReady when it lands, and fall back to a sync read where fences
// are absent. Driven entirely through a mock ReadbackSim — no GPU.
import { describe, it, expect, vi } from 'vitest';
import { StatsReadback } from './StatsReadback';

type Sim = Parameters<StatsReadback['pump']>[1];

function fakeSim(over: Partial<Record<keyof Sim, unknown>> = {}): Sim {
  return {
    pollReadback: vi.fn(() => false),
    requestReadback: vi.fn(() => true),
    readWater: vi.fn(),
    ...over,
  } as unknown as Sim;
}

describe('StatsReadback', () => {
  const buf = new Float32Array(4);

  it('kicks a readback once the interval elapses, then fires onReady when it lands', () => {
    const sim = fakeSim();
    const rb = new StatsReadback(0.4);
    const onReady = vi.fn();

    rb.pump(0.3, sim, buf, onReady); // below interval → nothing yet
    expect(sim.requestReadback).not.toHaveBeenCalled();

    rb.pump(0.2, sim, buf, onReady); // 0.5 ≥ 0.4 → kick (pending)
    expect(sim.requestReadback).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    (sim.pollReadback as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    rb.pump(0.1, sim, buf, onReady); // poll lands → onReady
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('falls back to a sync read + onReady when fences are unsupported', () => {
    const sim = fakeSim({ requestReadback: vi.fn(() => false) });
    const rb = new StatsReadback(0.4);
    const onReady = vi.fn();
    rb.pump(0.5, sim, buf, onReady);
    expect(sim.readWater).toHaveBeenCalledWith(buf);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not kick a second readback while one is still pending', () => {
    const sim = fakeSim({ pollReadback: vi.fn(() => false) });
    const rb = new StatsReadback(0.4);
    rb.pump(0.5, sim, buf, () => {}); // kick → pending
    rb.pump(0.5, sim, buf, () => {}); // still pending → no second kick
    expect(sim.requestReadback).toHaveBeenCalledTimes(1);
  });

  it('reset clears the pending flag and the accumulated time', () => {
    const sim = fakeSim();
    const rb = new StatsReadback(0.4);
    rb.pump(0.5, sim, buf, () => {}); // pending
    rb.reset();
    rb.pump(0.5, sim, buf, () => {}); // not pending after reset → kicks again
    expect(sim.requestReadback).toHaveBeenCalledTimes(2);
  });
});
