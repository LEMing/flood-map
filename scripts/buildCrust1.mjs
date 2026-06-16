// Build-time generator for public/crust1.bin — a compact, browser-loadable
// CRUST1.0 (Laske et al. 2013) global crustal model. The UCSD source host has
// no CORS, so we fetch + parse it here and ship a small binary the app loads
// directly. Run: node scripts/buildCrust1.mjs
//
// Output layout (little-endian):
//   [0..4)        magic "C1B0"
//   [4..64804)    Uint8[64800]   ocean flag per cell (1 = ocean)
//   [64804..)     Int16[64800*9] layer-top boundaries, DECAMETRES (×10 = m)
//
// Grid: 180 rows (lat) × 360 cols (lon), longitude is the inner loop.
// Layer order: water, ice, upper_sed, mid_sed, low_sed, upper_crust,
//              mid_crust, low_crust, mantle(=Moho top). Boundaries are
//              elevations relative to sea level in km, positive up.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = '/tmp/crust1-build';
const URL = 'https://igppweb.ucsd.edu/~gabi/crust1/crust1.0.tar.gz';
const CELLS = 180 * 360; // 64800
const LAYERS = 9;

function ensureBnds() {
  const bnds = join(TMP, 'crust1.bnds');
  if (existsSync(bnds)) return bnds;
  mkdirSync(TMP, { recursive: true });
  console.log('Downloading CRUST1.0…');
  execSync(`curl -sL --max-time 120 -o "${TMP}/crust1.0.tar.gz" "${URL}"`, { stdio: 'inherit' });
  execSync(`tar xzf "${TMP}/crust1.0.tar.gz" -C "${TMP}"`, { stdio: 'inherit' });
  if (!existsSync(bnds)) throw new Error('crust1.bnds not found after extraction');
  return bnds;
}

function build() {
  const text = readFileSync(ensureBnds(), 'utf8').trim();
  const lines = text.split('\n');
  if (lines.length !== CELLS) throw new Error(`expected ${CELLS} lines, got ${lines.length}`);

  const ocean = new Uint8Array(CELLS);
  const bounds = new Int16Array(CELLS * LAYERS);
  for (let c = 0; c < CELLS; c++) {
    const v = lines[c].trim().split(/\s+/).map(Number);
    if (v.length !== LAYERS) throw new Error(`line ${c} has ${v.length} values`);
    ocean[c] = v[0] - v[1] > 0 ? 1 : 0; // water thickness > 0
    for (let k = 0; k < LAYERS; k++) bounds[c * LAYERS + k] = Math.round(v[k] * 100); // km → decametres
  }

  const header = 4;
  const buf = Buffer.alloc(header + ocean.length + bounds.length * 2);
  buf.write('C1B0', 0, 'ascii');
  Buffer.from(ocean.buffer).copy(buf, header);
  Buffer.from(bounds.buffer, bounds.byteOffset, bounds.length * 2).copy(buf, header + ocean.length);

  mkdirSync(join(ROOT, 'public'), { recursive: true });
  const out = join(ROOT, 'public', 'crust1.bin');
  writeFileSync(out, buf);
  const oceanPct = ((ocean.reduce((s, x) => s + x, 0) / CELLS) * 100).toFixed(1);
  console.log(`Wrote ${out} (${buf.length} bytes, ${oceanPct}% ocean cells)`);
}

build();
