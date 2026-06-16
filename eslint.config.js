import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

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

  // Application + test sources: browser-targeted ES modules.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
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
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
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
);
