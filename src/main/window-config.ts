// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * The hardened `webPreferences` for the main window.
 *
 * Extracted from `index.ts` so the security flags can be asserted by a unit
 * test without importing Electron.
 */
export interface WindowWebPreferences {
  readonly preload: string
  readonly contextIsolation: true
  readonly sandbox: true
  readonly nodeIntegration: false
}

export function createWebPreferences(preloadPath: string): WindowWebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false
  }
}
