import { describe, it, expect } from 'vitest';
import indexHtml from '../../index.html?raw';

// Guard for scripts/build-place-pages.mjs: it rewrites these exact tags in the built
// index.html to generate the per-place SEO pages, and throws (failing the production
// build) if any pattern stops matching. This asserts the same patterns in the much
// faster test job, so a benign reformat of index.html fails here with a clear message
// instead of only at build time. Keep this list in sync with the generator's substitutions.
const PATTERNS: Array<[string, RegExp]> = [
  ['title', /<title>[\s\S]*?<\/title>/],
  ['description', /<meta\s+name="description"[\s\S]*?\/>/],
  ['canonical', /<link rel="canonical"[\s\S]*?\/>/],
  ['og:title', /<meta property="og:title"[\s\S]*?\/>/],
  ['og:description', /<meta\s+property="og:description"[\s\S]*?\/>/],
  ['og:url', /<meta property="og:url"[\s\S]*?\/>/],
  ['twitter:title', /<meta name="twitter:title"[\s\S]*?\/>/],
  ['twitter:description', /<meta\s+name="twitter:description"[\s\S]*?\/>/],
  ['</head>', /<\/head>/],
];

describe('per-place SEO generator patterns', () => {
  it.each(PATTERNS)('index.html still contains the %s tag the generator rewrites', (_name, re) => {
    expect(re.test(indexHtml)).toBe(true);
  });
});
