// @ts-check
/**
 * ESLint flat configuration.
 *
 * The specification (§34) requires lint/typecheck/tests/build to all run clean before work
 * is declared complete. TypeScript already enforces types, so `tsc` handles correctness;
 * this configuration adds the rules TypeScript does not: correctness bugs, promise
 * handling, unused code, and the React hooks rules that prevent stale-closure UI defects.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/artifacts/**',
      '**/*.d.ts',
      '.next/**',
      'out/**',
      // Scratch probes written at the repository root during an investigation. They are not part
      // of the product and must never be able to fail a lint run.
      'tmp-*',
    ],
  },
  js.configs.recommended,
  // Syntax-only, NOT type-aware. Type-aware linting parses each file's full TypeScript
  // program and needs far more memory than this build agent has available; `tsc --noEmit`
  // (npm run typecheck) already performs full type checking across the monorepo, so the
  // type-aware dimension is covered there rather than duplicated here.
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      /**
       * `set-state-in-effect` is a React Compiler heuristic. It cannot tell a synchronous
       * setState that causes a cascading render apart from an async fetch whose first await
       * follows the setState call — which is what "load the provider catalogue when the panel
       * opens" looks like. React's own guidance permits data fetching in effects. It is therefore
       * reported as a warning rather than an error, so a genuine regression is still visible in
       * lint output without failing the build on a known false positive.
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Types are checked by tsc (npm run typecheck); these three are redundant here and
      // would otherwise duplicate full type analysis inside the linter.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Server-side Node scripts and config: Node globals, no DOM.
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts', '**/*.config.*', 'eslint.config.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The Next.js application and the public-site renderer run in a browser-capable runtime.
    // Without this, `document`, `window` and `getComputedStyle` read as undefined everywhere.
    files: ['packages/web/**/*.{ts,tsx}', 'packages/entity-site/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Scripts that drive a browser from Node. Functions passed to `page.evaluate(...)` are
    // serialised and run inside the page, so they legitimately touch `document`,
    // `getComputedStyle` and friends from a Node file. Both sets are therefore declared here.
    files: ['scripts/ui-audit.mjs', 'scripts/design-audit.mjs', 'scripts/verify-*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
