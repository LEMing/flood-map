/**
 * dependency-cruiser config for flood-map. Enforces the layered architecture:
 *
 *   main ─► app ─► { render, sim, ui } ─► geo ─► { config, i18n, url, analytics }
 *
 * `app/` is the composition root (only main.ts may import it). `geo/` is the
 * data/domain layer and must not reach up into rendering/sim/ui. Core leaf
 * modules (config, i18n, url, analytics) must not depend on any feature layer.
 * Rules sit at `error` where the graph is already clean, `warn` where a
 * pre-existing seam needs a dedicated cleanup pass — never silently demote.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make the module graph impossible to reason about.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-test-import-in-prod',
      severity: 'error',
      comment: 'Production code must never import a *.test.ts file.',
      from: { pathNot: '\\.test\\.ts$' },
      to: { path: '\\.test\\.ts$' },
    },
    {
      name: 'only-main-imports-app',
      severity: 'error',
      comment: 'app/ is the composition root — only main.ts may import it.',
      from: { pathNot: '^(src/main\\.ts|src/app/)' },
      to: { path: '^src/app/' },
    },
    {
      name: 'geo-stays-domain',
      severity: 'error',
      comment: 'geo/ is the data/domain layer; it must not reach up into rendering, sim or UI.',
      from: { path: '^src/geo/' },
      to: { path: ['^src/render/', '^src/sim/', '^src/ui/', '^src/app/'] },
    },
    {
      name: 'sim-no-render-ui-app',
      severity: 'error',
      comment: 'The GPU sim must not depend on rendering, UI or the app shell.',
      from: { path: '^src/sim/' },
      to: { path: ['^src/render/', '^src/ui/', '^src/app/'] },
    },
    {
      name: 'render-no-app-ui',
      severity: 'error',
      comment: 'render/ must not depend on the app shell or UI panels.',
      from: { path: '^src/render/' },
      to: { path: ['^src/app/', '^src/ui/'] },
    },
    {
      name: 'core-stays-leaf',
      severity: 'error',
      comment: 'config / url / analytics must not depend on any feature layer.',
      from: { path: '^src/(config|url|analytics)\\.ts$' },
      to: { path: ['^src/app/', '^src/render/', '^src/sim/', '^src/geo/', '^src/ui/'] },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unused module (no importers) — dead code unless it is an entry point.',
      from: {
        orphan: true,
        pathNot: ['^src/main\\.ts$', '\\.test\\.ts$', '\\.d\\.ts$', '(^|/)vite-env\\.d\\.ts$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: 'node_modules' },
  },
};
