import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Dev-server proxies so the browser can reach Nominatim + AWS Terrain Tiles
// without CORS issues. The proxy also injects the User-Agent that the
// Nominatim usage policy requires (stock browser UA is rejected).
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries into their own chunks so a
        // one-line app edit doesn't bust their (immutable-cached) download for
        // returning visitors. three + tweakpane are only pulled by the lazily
        // imported App, so they also stay off the landing's critical path.
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/tweakpane') || id.includes('node_modules/@tweakpane')) return 'tweakpane';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/geocode': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/geocode/, ''),
        headers: {
          'User-Agent': 'flood-map-demo/0.1 (educational flood simulation)',
          Referer: 'http://localhost/',
        },
      },
      '/api/tiles': {
        target: 'https://s3.amazonaws.com/elevation-tiles-prod',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/tiles/, ''),
      },
      '/api/sat': {
        target: 'https://server.arcgisonline.com',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(/^\/api\/sat/, '/ArcGIS/rest/services/World_Imagery/MapServer/tile'),
      },
      // Copernicus DEM GLO-30 (Cloud-Optimized GeoTIFF, AWS Open Data, no key).
      '/api/cop30': {
        target: 'https://copernicus-dem-30m.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/cop30/, ''),
      },
      // FABDEM is fetched directly from the Hugging Face CDN (CORS + range);
      // its signed LFS redirect can't be proxied cleanly, so no proxy here.
      // ESA WorldCover 10 m land cover (public S3, COG).
      '/api/worldcover': {
        target: 'https://esa-worldcover.s3.eu-central-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/worldcover/, ''),
      },
      // OSM Overpass is fetched directly from CORS-enabled mirrors (see geo/osm.ts).
    },
  },
});
