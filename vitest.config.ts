// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    // Node is the default so the main-process/core suites stay lightweight;
    // renderer suites opt into jsdom with a `@vitest-environment` docblock.
    environment: 'node',
    include: [
      'src/test/**/*.test.ts',
      'src/main/**/*.test.ts',
      'src/core/**/*.test.ts',
      'src/renderer/**/*.test.{ts,tsx}'
    ]
  }
})
