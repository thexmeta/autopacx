// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp, type TrackedAppInit } from '@core/models/tracked-app'
import { executableName, needsInstallTarget } from './install-options'

function app(overrides: Partial<TrackedAppInit> = {}): TrackedApp {
  return new TrackedApp({
    repoOwner: 'owner',
    repoName: 'MyRepo',
    displayName: 'My App',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  })
}

describe('executableName', () => {
  it('uses the basename of the first token of the launch command', () => {
    expect(executableName(app({ launchCommand: '/usr/bin/tool --flag' }))).toBe('tool')
  })

  it('falls back to the package name', () => {
    expect(executableName(app({ packageName: 'my-pkg' }))).toBe('my-pkg')
  })

  it('falls back to the lower-cased repo name', () => {
    expect(executableName(app())).toBe('myrepo')
  })
})

describe('needsInstallTarget', () => {
  it('is true only for a raw binary install', () => {
    expect(needsInstallTarget('binary')).toBe(true)
    expect(needsInstallTarget('deb')).toBe(false)
    expect(needsInstallTarget('appImage')).toBe(false)
    expect(needsInstallTarget(null)).toBe(false)
  })
})
