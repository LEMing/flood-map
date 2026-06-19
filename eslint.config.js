import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Rules mirror the @ergeon house style (site-plan-engine parity): structural
// budgets (max-lines 300, complexity 10, max-params 4), single quotes, 120-col
// lines, and the strict TS safety rules (no-explicit-any, no-non-null-assertion,
// no-floating-promises). flood-map is a PUBLIC repo, so the @ergeon shared
// config can't be imported from the private registry — the rules are inlined.
export default tseslint.config(
  {
    // Never lint build output, deps, static assets, or machine-generated data.
    // The regional*.ts files in src/geo/data are emitted by scripts/build*.mjs.
    ignores: [
      'dist/',
      'node_modules/',
      'public/',
      '.firebase/',
      'src/geo/data/regional*.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Application + test sources: browser-targeted ES modules, type-aware so
  // no-floating-promises (which needs type information) can run.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Require strict equality everywhere except the `x == null` idiom,
      // which intentionally matches both null and undefined.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-labels': 'error',
      'no-multiple-empty-lines': ['error', { max: 1 }],
      quotes: ['error', 'single', 'avoid-escape'],
      'max-len': [
        'error',
        { code: 120, tabWidth: 2, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true },
      ],
      'max-params': ['error', 4],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // ── TECH-DEBT LEDGER ──────────────────────────────────────────────────
  // Files that exceed the structural budgets above. Each is a tracked
  // decomposition/refactor target; the override is removed as the file is
  // brought into budget. NEW files must comply — do not add entries here
  // without a paydown plan. (Mirrors site-plan-engine's per-area relaxations
  // for ported/algorithmic code.)

  // App.ts: the composition root / orchestrator. The heavy subsystems are their
  // own modules (GeologyController, MarkerLayer, PointerController, SimDriver,
  // WorldBuilder) and the standalone widgets (FpsBadge, HeatLegend, chromeToggle)
  // are extracted; what remains wires scene-post + world meshes + sim + UI +
  // geology together each frame and on a param change. applyParams is an inherent
  // param fan-out, so the budgets are raised (not off) to ratchet against
  // unbounded regrowth — splitting further would only create feature-envy classes
  // that reach straight back into the app.
  {
    files: ['src/app/App.ts'],
    rules: {
      'max-lines': ['error', { max: 480, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 14],
    },
  },

  // render/*: three.js wiring constructors take many deps and a couple of hot
  // methods sit just over the complexity bar.
  {
    files: ['src/render/**/*.ts'],
    rules: { complexity: ['error', 11], 'max-params': ['error', 7] },
  },

  // geo/*: data-acquisition layer — tile fetch/fallback chains, raster decode
  // and terrain classification carry inherent branching. Worst offenders
  // (inpaintHoles, computeSurfaceFields) tracked for helper extraction.
  {
    files: ['src/geo/**/*.ts'],
    ignores: ['src/geo/**/*.test.ts'],
    rules: { complexity: ['error', 20], 'max-params': ['error', 6] },
  },

  // url.ts writeUrlState: flat Params→query-string serialization.
  {
    files: ['src/url.ts'],
    rules: { complexity: ['error', 11] },
  },

  // Shader-source modules: a *.glsl.ts file is just GLSL string constants
  // (GPU source text, not logic), so the line budget doesn't apply — same
  // rationale as the generated data files.
  {
    files: ['src/**/*.glsl.ts'],
    rules: { 'max-lines': 'off' },
  },

  // sim/*: GPUComputationRenderer wiring constructor takes several render targets.
  {
    files: ['src/sim/**/*.ts'],
    rules: { 'max-params': ['error', 5] },
  },

  // Tests favour readability over the production budgets.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      complexity: ['error', 20],
      'max-params': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Build/codegen scripts and Vite config run under Node, not the browser.
  {
    files: ['scripts/**/*.{mjs,js}', 'vite.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // CommonJS config files (e.g. dependency-cruiser.config.cjs).
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
);
