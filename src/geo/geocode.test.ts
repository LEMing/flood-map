import { describe, it, expect } from 'vitest';
import { shortLabel, shortPlaceName } from './geocode';

describe('shortPlaceName', () => {
  it('keeps the two most specific parts', () => {
    expect(shortPlaceName('Krasnodar, Krasnodar Krai, Russia')).toBe('Krasnodar, Krasnodar Krai');
  });

  it('trims whitespace and drops empty segments', () => {
    expect(shortPlaceName('  Paris ,  Île-de-France , France')).toBe('Paris, Île-de-France');
  });

  it('passes a single-part name through', () => {
    expect(shortPlaceName('Antarctica')).toBe('Antarctica');
  });
});

describe('shortLabel', () => {
  it('shortens a multi-part display name', () => {
    expect(shortLabel({ lat: 48.85, lon: 2.35, displayName: 'Paris, Île-de-France, France' }))
      .toBe('Paris, Île-de-France');
  });

  it('passes a raw "lat, lon" display name through untouched', () => {
    expect(shortLabel({ lat: 45.05, lon: 38.97, displayName: '45.05, 38.97' })).toBe('45.05, 38.97');
  });
});
