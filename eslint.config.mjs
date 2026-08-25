import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.tsbuildinfo']
  },

  // Agent tooling: the run-skill driver is a plain Node ESM script, not app
  // source. It needs BOTH global sets — the script runs in Node, but the bodies
  // it hands to page.evaluate() execute in the app's renderer.
  {
    files: ['.claude/skills/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      ecmaVersion: 'latest',
      sourceType: 'module'
    }
  },

  // Base + TypeScript recommended rules for all TS/TSX source
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Renderer (React) code
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      // Classic, high-signal hooks rules only. The newer React-Compiler rules
      // bundled in eslint-plugin-react-hooks' "recommended" config are too noisy
      // for this existing codebase and are intentionally left disabled for now.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Prefer the @/ alias over deep relative parent imports
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the "@/" path alias instead of deep relative imports.'
            }
          ]
        }
      ]
    }
  },

  // Electron main + preload (Node context)
  {
    files: ['electron/**/*.ts', 'electron-vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Pragmatic relaxations for an existing codebase with no prior linting
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // Intentional ignore-and-continue catch blocks are common in this codebase.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
)
