import { describe, it, expect } from 'vitest';
import { formatVolume, formatWaterBalance } from './stats';

describe('formatVolume', () => {
  it('uses plain m³ below a thousand', () => {
    expect(formatVolume(0)).toBe('0 m³');
    expect(formatVolume(742.6)).toBe('743 m³');
  });

  it('switches to ×10³ then ×10⁶ as the volume grows', () => {
    expect(formatVolume(4_120)).toBe('4.1 ×10³ m³');
    expect(formatVolume(2_500_000)).toBe('2.50 ×10⁶ m³');
  });
});

describe('formatWaterBalance', () => {
  it('reads em-dash before any water has entered', () => {
    expect(formatWaterBalance(0, 0, 0)).toBe('—');
  });

  it('reports the ponded fraction and the lost remainder of the input', () => {
    // 1000 m³ rained, 300 still ponded -> 30% ponded, 700 lost.
    expect(formatWaterBalance(1000, 0, 300)).toBe('~30% ponded · 700 m³ lost');
  });

  it('counts manual dumps as input, not as a conservation violation', () => {
    // Without the dump in the denominator, 600/500 would read >100% ponded.
    expect(formatWaterBalance(500, 500, 600)).toBe('~60% ponded · 400 m³ lost');
  });

  it('clamps retained to 100% and lost to zero when stored exceeds tracked input', () => {
    // Bathtub "fill" adds water outside the flux budget — never show >100% / negative.
    expect(formatWaterBalance(100, 0, 250)).toBe('~100% ponded · 0 m³ lost');
  });
});
