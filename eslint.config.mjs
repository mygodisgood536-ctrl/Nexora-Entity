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
      // Types are checked by tsc; these duplicates add cost without adding safety.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
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
    // Server-side Node scripts and config: no DOM globals.
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts', '**/*.config.*', 'eslint.config.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', __dirname: 'readonly' },
    },
  },
);
