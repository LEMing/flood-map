// Unit tests for the shareable-URL state codec. The pure coordinate helpers
// (parseCoords/formatCoords) are exercised against valid/invalid forms,
// bounds, and a format->parse round-trip. read/writeUrlState touch
// window.location/history, which don't exist in the default node env, so we
// install a minimal stub instead of pulling in a full DOM.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseCoords, formatCoords, readUrlState, writeUrlState } from './url';

describe('parseCoords', () => {
  it('parses "lat, lon" with a comma and spaces', () => {
    expect(parseCoords('45.0, 38.9')).toEqual({ lat: 45.0, lon: 38.9 });
  });

  it('parses a comma without surrounding spaces', () => {
    expect(parseCoords('45,38.9')).toEqual({ lat: 45, lon: 38.9 });
  });

  it('tolerates leading/trailing whitespace', () => {
    expect(parseCoords('  12.5 , -77.25  ')).toEqual({ lat: 12.5, lon: -77.25 });
  });

  it('parses a space-separated pair', () => {
    expect(parseCoords('45 38.9')).toEqual({ lat: 45, lon: 38.9 });
  });

  it('parses a semicolon-separated pair', () => {
    expect(parseCoords('45;38.9')).toEqual({ lat: 45, lon: 38.9 });
  });

  it('parses negative coordinates in both fields', () => {
    expect(parseCoords('-33.8688, -151.2093')).toEqual({
      lat: -33.8688,
      lon: -151.2093,
    });
  });

  it('accepts the exact min/max bounds', () => {
    expect(parseCoords('-90, -180')).toEqual({ lat: -90, lon: -180 });
    expect(parseCoords('90, 180')).toEqual({ lat: 90, lon: 180 });
  });

  it('returns null for out-of-range latitude', () => {
    // 91 is structurally valid (two digits) but outside [-90, 90].
    expect(parseCoords('91, 0')).toBeNull();
  });

  it('returns null for out-of-range longitude', () => {
    expect(parseCoords('0, 181')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parseCoords('')).toBeNull();
    expect(parseCoords('   ')).toBeNull();
  });

  it('returns null for non-numeric or malformed input', () => {
    expect(parseCoords('hello world')).toBeNull();
    expect(parseCoords('45.0')).toBeNull();
    expect(parseCoords('45.0, 38.9, 1.0')).toBeNull();
    expect(parseCoords('45.0,')).toBeNull();
    expect(parseCoords('abc, def')).toBeNull();
  });

  it('rejects latitude with more than two integer digits', () => {
    // The regex caps latitude at two integer digits, so 100 cannot match.
    expect(parseCoords('100, 50')).toBeNull();
  });
});

describe('formatCoords', () => {
  it('formats to five fixed decimal places', () => {
    expect(formatCoords(45, 38.9)).toBe('45.00000, 38.90000');
  });

  it('rounds to five decimals', () => {
    expect(formatCoords(1.234567, -7.654321)).toBe('1.23457, -7.65432');
  });

  it('round-trips through parseCoords for representative points', () => {
    const points: Array<{ lat: number; lon: number }> = [
      { lat: 45.0, lon: 38.9 },
      { lat: -33.8688, lon: 151.2093 },
      { lat: 0, lon: 0 },
      { lat: -90, lon: -180 },
      { lat: 90, lon: 180 },
    ];
    for (const p of points) {
      const parsed = parseCoords(formatCoords(p.lat, p.lon));
      expect(parsed).not.toBeNull();
      expect(parsed!.lat).toBeCloseTo(p.lat, 5);
      expect(parsed!.lon).toBeCloseTo(p.lon, 5);
    }
  });
});

// Minimal window stub: read/writeUrlState only read location.search /
// location.pathname and call history.replaceState. We model the URL as a
// mutable string and keep search/pathname in sync, so writeUrlState's output
// can be fed straight back into readUrlState.
class FakeLocation {
  pathname = '/';
  search = '';
  setUrl(url: string): void {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) {
      this.pathname = url || '/';
      this.search = '';
    } else {
      this.pathname = url.slice(0, qIndex) || '/';
      this.search = url.slice(qIndex);
    }
  }
}

interface WindowLike {
  location: FakeLocation;
  history: { replaceState: (data: unknown, unused: string, url: string) => void };
}

// The default node env has no `window`; install/remove it around each test.
// Cast through `unknown` because lib.dom types `window` as the full Window and
// our stub only implements the slice url.ts touches.
const windowHost = globalThis as unknown as { window?: WindowLike };

describe('readUrlState / writeUrlState', () => {
  let location: FakeLocation;

  beforeEach(() => {
    location = new FakeLocation();
    windowHost.window = {
      location,
      history: {
        replaceState: (_data, _unused, url) => location.setUrl(url),
      },
    };
  });

  afterEach(() => {
    delete windowHost.window;
  });

  it('reads numeric fields, lang, and demo from the query string', () => {
    location.search = '?lat=45.5&lon=-38.25&km=12&grid=256&lang=ru&demo=1';
    expect(readUrlState()).toEqual({
      lat: 45.5,
      lon: -38.25,
      km: 12,
      grid: 256,
      lang: 'ru',
      demo: true,
    });
  });

  it('treats demo=true as true and any other value as false', () => {
    location.search = '?demo=true';
    expect(readUrlState().demo).toBe(true);
    location.search = '?demo=0';
    expect(readUrlState().demo).toBe(false);
    location.search = '?demo=yes';
    expect(readUrlState().demo).toBe(false);
  });

  it('returns undefined for absent or non-finite numeric fields', () => {
    location.search = '?lat=notanumber';
    const state = readUrlState();
    expect(state.lat).toBeUndefined();
    expect(state.lon).toBeUndefined();
    expect(state.km).toBeUndefined();
    expect(state.grid).toBeUndefined();
    expect(state.lang).toBeUndefined();
    expect(state.demo).toBeUndefined();
  });

  it('writes lat/lon with five-decimal precision and km/grid verbatim', () => {
    writeUrlState({ lat: 45.123456, lon: -38.987654, km: 10, grid: 128 });
    const params = new URLSearchParams(location.search);
    expect(params.get('lat')).toBe('45.12346');
    expect(params.get('lon')).toBe('-38.98765');
    expect(params.get('km')).toBe('10');
    expect(params.get('grid')).toBe('128');
  });

  it('produces a query string that readUrlState parses back equivalently', () => {
    writeUrlState({ lat: 12.5, lon: 77.25, km: 8, grid: 512, lang: 'es', demo: true });
    const state = readUrlState();
    expect(state).toEqual({
      lat: 12.5,
      lon: 77.25,
      km: 8,
      grid: 512,
      lang: 'es',
      demo: true,
    });
  });

  it('deletes a key when demo is false and drops the query when empty', () => {
    location.search = '?demo=1';
    writeUrlState({ demo: false });
    expect(location.search).toBe('');
    expect(location.pathname).toBe('/');
    expect(readUrlState().demo).toBeUndefined();
  });

  it('merges a patch into existing params without clobbering others', () => {
    location.search = '?lat=10.00000&lon=20.00000&lang=ru';
    writeUrlState({ km: 5 });
    const state = readUrlState();
    expect(state.lat).toBeCloseTo(10, 5);
    expect(state.lon).toBeCloseTo(20, 5);
    expect(state.lang).toBe('ru');
    expect(state.km).toBe(5);
  });
});
