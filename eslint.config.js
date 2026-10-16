// ESLint flat config for the whole monorepo (service + dashboard).
// Run from the repo root: `npm run lint`.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Leading underscore marks an intentionally unused arg, e.g. Express's `_req`.
const unusedVarsOptions = { argsIgnorePattern: '^_' };

export default defineConfig(
  {
    // Build output and generated reports are never linted.
    ignores: ['**/dist/**', '**/coverage/**', 'reports/**'],
  },

  // Node code: the service, the dashboard backend, and root config files.
  {
    files: ['service/**/*.js', 'dashboard/server/**/*.ts', '*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // Plain JavaScript.
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    rules: {
      'no-unused-vars': ['error', unusedVarsOptions],
    },
  },

  // TypeScript. The TS preset turns off core rules that TypeScript already checks.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions],
    },
  },

  // The React app (added in Phase 10) runs in the browser.
  {
    files: ['dashboard/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
