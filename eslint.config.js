// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const reactHooks = require('eslint-plugin-react-hooks')
const reactRefreshModule = require('eslint-plugin-react-refresh')
const globals = require('globals')
const prettier = require('eslint-config-prettier')

// eslint-plugin-react-refresh is ESM-only; unwrap the default export when
// required from a CommonJS flat config.
const reactRefresh = reactRefreshModule.default ?? reactRefreshModule

module.exports = tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      // Temporary files emitted by electron-vite / pnpm tooling.
      'electron.vite.config.*.mjs',
      '_tmp_*'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  prettier
)
