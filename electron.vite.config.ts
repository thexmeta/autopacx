// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const coreAlias = { '@core': resolve('src/core') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: coreAlias
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: coreAlias
    }
  },
  renderer: {
    resolve: {
      alias: {
        ...coreAlias,
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
