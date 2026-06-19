// ScenarioUrl maps the shareable /sim URL onto params and mirrors changes back.
// It touches window/document, absent in the node env, so we install a minimal
// stub (the test eslint override permits `any` for that).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScenarioUrl } from './ScenarioUrl';
import { DEFAULT_PARAMS, type Params } from '../config';

class FakeLocation {
  pathname = '/sim';
  search = '';
  setUrl(url: string): void {
    const q = url.indexOf('?');
    if (q === -1) { this.pathname = url || '/'; this.search = ''; }
    else { this.pathname = url.slice(0, q) || '/'; this.search = url.slice(q); }
  }
}

const host = globalThis as any;
let location: FakeLocation;

function params(over: Partial<Params> = {}): Params {
  return { ...DEFAULT_PARAMS, ...over };
}
function make(p: Params): ScenarioUrl {
  return new ScenarioUrl(p, () => 'Somewhere');
}

beforeEach(() => {
  location = new FakeLocation();
  host.window = {
    location,
    history: { replaceState: (_d: unknown, _u: string, url: string) => location.setUrl(url) },
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  };
  host.document = { getElementById: () => null };
});

afterEach(() => {
  delete host.window;
  delete host.document;
});

describe('ScenarioUrl.applyFromUrl', () => {
  it('maps water to fillLevelM, turns on the live flood level, and stops the rain', () => {
    const p = params({ floodLevelLive: false, fillLevelM: 5, raining: true });
    make(p).applyFromUrl({ water: 1.5 });
    expect(p.fillLevelM).toBe(1.5);
    expect(p.floodLevelLive).toBe(true);
    expect(p.raining).toBe(false); // clean static-flood snapshot
  });

  it('round-trips water=0 (still enables the live flood level)', () => {
    const p = params({ floodLevelLive: false });
    make(p).applyFromUrl({ water: 0 });
    expect(p.fillLevelM).toBe(0);
    expect(p.floodLevelLive).toBe(true);
  });

  it('applies storm / style / src / b3d / overlay / ve', () => {
    const p = params();
    make(p).applyFromUrl({ storm: 'design25yr', style: 'heatmap', src: 'glo30', b3d: false, overlay: true, ve: 2 });
    expect(p.stormType).toBe('design25yr');
    expect(p.terrainStyle).toBe('heatmap');
    expect(p.elevationSource).toBe('glo30');
    expect(p.buildings3D).toBe(false);
    expect(p.floodOverlay).toBe(true);
    expect(p.verticalExaggeration).toBe(2);
  });

  it('leaves params at their defaults for an empty URL', () => {
    const p = params();
    make(p).applyFromUrl({});
    expect(p.terrainStyle).toBe(DEFAULT_PARAMS.terrainStyle);
    expect(p.floodLevelLive).toBe(DEFAULT_PARAMS.floodLevelLive);
  });
});

describe('ScenarioUrl.queueSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes only non-default scenario knobs on /sim', () => {
    location.pathname = '/sim';
    make(params({ terrainStyle: 'heatmap' })).queueSync(); // buildings3D stays at its default
    vi.advanceTimersByTime(500);
    const sp = new URLSearchParams(location.search);
    expect(sp.get('style')).toBe('heatmap');
    expect(sp.has('b3d')).toBe(false); // default → omitted, URL stays clean
  });

  it('does NOT pollute the landing ("/") URL when the timer fires off-route', () => {
    location.pathname = '/';
    make(params({ terrainStyle: 'heatmap' })).queueSync();
    vi.advanceTimersByTime(500);
    expect(location.search).toBe('');
  });
});
