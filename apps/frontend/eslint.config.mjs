import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next 16 removed `next lint`; the script is plain `eslint .` (R15). `_`-prefixed names are deliberately unused.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'node_modules/**', 'next-env.d.ts', 'public/**']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  // The repro pack (v6.1.17 Task 5) reads untyped MCP and SQL rows by design; it is a local test tool, never imported by the app.
  {
    files: ['scripts/repro/**/*.mts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]);
