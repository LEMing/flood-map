// parseSoilTexture turns a SoilGrids reply into the topsoil sand/clay/organic-matter the
// pedotransfer needs — the one offline-testable step of the soil→infiltration path. Guards
// the g/kg→% conversions, the 0–30 cm thickness weighting, and the masked-pixel fallback.
import { describe, it, expect } from 'vitest';
import { parseSoilTexture } from './soilgrids';

type Band = { sand: number | null; clay: number | null; soc: number | null };

// SoilGrids reports sand/clay/soc in g/kg (the parser divides by 10 → %, and soc/10 → g/kg).
function reply(bands: Band[]): Parameters<typeof parseSoilTexture>[0] {
  const layer = (name: string, key: keyof Band) => ({
    name,
    depths: bands.map((b, i) => ({
      label: `d${i}`,
      range: { top_depth: 0, bottom_depth: 5, unit_depth: 'cm' },
      values: { mean: b[key] },
    })),
  });
  return { properties: { layers: [layer('sand', 'sand'), layer('clay', 'clay'), layer('soc', 'soc')] } };
}

describe('parseSoilTexture', () => {
  it('converts g/kg to fractions and weights the 0–30 cm topsoil', () => {
    // Uniform topsoil: sand 400 g/kg → 40%, clay 200 → 20%, soc 200 → 20 g/kg → OM 3.45%.
    const tex = parseSoilTexture(reply([
      { sand: 400, clay: 200, soc: 200 },
      { sand: 400, clay: 200, soc: 200 },
      { sand: 400, clay: 200, soc: 200 },
      { sand: 999, clay: 999, soc: 999 }, // deeper band — must be ignored
    ]));
    expect(tex).not.toBeNull();
    expect(tex!.sandFrac).toBeCloseTo(0.4, 5);
    expect(tex!.clayFrac).toBeCloseTo(0.2, 5);
    expect(tex!.omPct).toBeCloseTo((20 / 10) * 1.724, 4);
  });

  it('thickness-weights unequal bands (15 cm band dominates the 5 cm band)', () => {
    // bands 5/10/15 cm; clay 100/100/300 → weighted = (100·5+100·10+300·15)/30 = 200 g/kg → 20%.
    const tex = parseSoilTexture(reply([
      { sand: 500, clay: 100, soc: 100 },
      { sand: 500, clay: 100, soc: 100 },
      { sand: 500, clay: 300, soc: 100 },
    ]));
    expect(tex!.clayFrac).toBeCloseTo(0.2, 5);
  });

  it('returns null when sand/clay are absent (masked pixel)', () => {
    expect(parseSoilTexture(reply([{ sand: null, clay: null, soc: null }]))).toBeNull();
    expect(parseSoilTexture({ properties: { layers: [] } })).toBeNull();
  });
});
