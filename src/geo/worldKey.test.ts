import { describe, it, expect } from 'vitest';
import { worldKey, type WorldRequest } from './worldKey';
import { DEFAULT_PARAMS } from '../config';

function req(over: Partial<WorldRequest> = {}): WorldRequest {
  return {
    location: { lat: 45.0355, lon: 38.975, displayName: 'Krasnodar' },
    mapSizeKm: 4,
    N: 1024,
    elevationSource: 'glo30',
    useSurface: true,
    params: DEFAULT_PARAMS,
    ...over,
  };
}

describe('worldKey', () => {
  it('is stable for identical requests', () => {
    expect(worldKey(req())).toBe(worldKey(req()));
  });

  it('ignores params (the landing prefetch and sim build share the key)', () => {
    const other = { ...DEFAULT_PARAMS, running: !DEFAULT_PARAMS.running };
    expect(worldKey(req({ params: other }))).toBe(worldKey(req()));
  });

  it('quantizes location to 4 decimals so sub-~10 m drift still hits', () => {
    const a = worldKey(req({ location: { lat: 45.0355, lon: 38.975, displayName: 'a' } }));
    const b = worldKey(req({ location: { lat: 45.035504, lon: 38.974998, displayName: 'b' } }));
    expect(a).toBe(b);
  });

  it('separates distinct size / grid / source / surface', () => {
    const base = worldKey(req());
    expect(worldKey(req({ mapSizeKm: 8 }))).not.toBe(base);
    expect(worldKey(req({ N: 2048 }))).not.toBe(base);
    expect(worldKey(req({ elevationSource: 'fabdem' }))).not.toBe(base);
    expect(worldKey(req({ useSurface: false }))).not.toBe(base);
  });
});
