// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { createWebPreferences } from '../main/window-config'

describe('createWebPreferences', () => {
  it('enables the renderer sandbox and context isolation with no Node integration', () => {
    const prefs = createWebPreferences('/opt/app/preload/index.js')

    expect(prefs).toEqual({
      preload: '/opt/app/preload/index.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    })
  })

  it('exposes exactly the hardened flag set', () => {
    expect(Object.keys(createWebPreferences('x')).sort()).toEqual([
      'contextIsolation',
      'nodeIntegration',
      'preload',
      'sandbox'
    ])
  })
})
