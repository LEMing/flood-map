// Post-build: generate static, crawlable per-place landing pages at
// dist/flood/<slug>/index.html for the curated demo locations. Each page is a
// copy of the built index.html with a place-specific <title>, description,
// canonical and social tags, plus a boot hint (window.__FLOOD_PLACE__) so the
// SPA preselects that place on load (real terrain, warm prefetch).
//
// FRAMING GUARDRAIL: titles/descriptions say "see how water moves on real
// terrain in {place}", never "will {place} flood" — the product is an
// educational sandbox, not a flood-risk forecast.
//
// Per-place OG IMAGES still need a render step (a Cloud Function or a build-time
// canvas); until then every page reuses the shared static og-card. Logged below.
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const HOST = 'https://krd-flood.web.app';

const PLACES = [
  { slug: 'rio', name: 'Rio de Janeiro', label: 'Rio de Janeiro, Brazil', lat: -22.9519, lon: -43.2106 },
  { slug: 'venice', name: 'Venice', label: 'Venice, Italy', lat: 45.4371, lon: 12.3326 },
  { slug: 'amsterdam', name: 'Amsterdam', label: 'Amsterdam, North Holland', lat: 52.3676, lon: 4.9041 },
  { slug: 'boulder', name: 'Boulder', label: 'Boulder, Colorado', lat: 40.01499, lon: -105.27055 },
  { slug: 'lynmouth', name: 'Lynmouth', label: 'Lynmouth, UK', lat: 51.229, lon: -3.8299 },
];

const tplPath = path.join(DIST, 'index.html');
if (!fs.existsSync(tplPath)) {
  console.error('build-place-pages: dist/index.html not found — run after vite build');
  process.exit(1);
}
const tpl = fs.readFileSync(tplPath, 'utf8');

const sub = (html, re, replacement) => {
  if (!re.test(html)) throw new Error(`build-place-pages: pattern not found: ${re}`);
  return html.replace(re, replacement);
};

function pageFor(p) {
  const url = `${HOST}/flood/${p.slug}/`; // trailing slash matches Firebase's directory-index serving
  const title = `${p.name} flood simulation — watch how water moves on real terrain | Floodlab`;
  const desc = `Run a design storm over ${p.name}’s real 3D terrain in your browser and watch where rain collects, channels, and drains. An educational physics sandbox — not a flood-risk forecast.`;
  const boot = `<script>window.__FLOOD_PLACE__=${JSON.stringify({ lat: p.lat, lon: p.lon, label: p.label, slug: p.slug })}</script>`;

  let html = tpl;
  html = sub(html, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  html = sub(html, /<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="${desc}" />`);
  html = sub(html, /<link rel="canonical"[\s\S]*?\/>/, `<link rel="canonical" href="${url}" />`);
  html = sub(html, /<meta property="og:title"[\s\S]*?\/>/, `<meta property="og:title" content="${title}" />`);
  html = sub(html, /<meta\s+property="og:description"[\s\S]*?\/>/, `<meta property="og:description" content="${desc}" />`);
  html = sub(html, /<meta property="og:url"[\s\S]*?\/>/, `<meta property="og:url" content="${url}" />`);
  html = sub(html, /<meta name="twitter:title"[\s\S]*?\/>/, `<meta name="twitter:title" content="${title}" />`);
  html = sub(html, /<meta\s+name="twitter:description"[\s\S]*?\/>/, `<meta name="twitter:description" content="${desc}" />`);
  html = sub(html, /<\/head>/, `  ${boot}\n  </head>`);
  return html;
}

let n = 0;
for (const p of PLACES) {
  const dir = path.join(DIST, 'flood', p.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), pageFor(p));
  n += 1;
}

// Register the routes in the sitemap (the SPA links to them too, but the sitemap is the
// primary discovery path) — driven by the same PLACES array, idempotent across re-runs.
const smPath = path.join(DIST, 'sitemap.xml');
if (fs.existsSync(smPath)) {
  let sm = fs.readFileSync(smPath, 'utf8');
  if (!sm.includes('/flood/')) {
    const entries = PLACES.map((p) =>
      `  <url>\n    <loc>${HOST}/flood/${p.slug}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    ).join('\n');
    sm = sm.replace('</urlset>', `${entries}\n</urlset>`);
    fs.writeFileSync(smPath, sm);
  }
}
console.log(`build-place-pages: generated ${n} per-place SEO pages + sitemap entries (og:image still shared — per-place render is a follow-up)`);
