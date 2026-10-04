// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { rehydrateApps } from './use-apps'
import { rehydrateDebPackages } from './use-deb-packages'

describe('rehydrateApps', () => {
  it('maps wire maps to TrackedApp models with working getters', () => {
    const wire = new TrackedApp({
      id: 1,
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App One',
      installedVersion: '1.0.0',
      latestVersion: '1.1.0',
      createdAt: new Date('2026-01-01T00:00:00Z')
    }).toMap()

    const [app] = rehydrateApps([wire])

    expect(app).toBeInstanceOf(TrackedApp)
    expect(app.displayName).toBe('App One')
    expect(app.hasUpdate).toBe(true)
    expect(app.isInstalled).toBe(true)
    expect(app.repoUrl).toBe('https://github.com/owner/repo')
  })

  it('returns an empty list for an empty wire list', () => {
    expect(rehydrateApps([])).toEqual([])
  })
})

describe('rehydrateDebPackages', () => {
  it('maps wire maps to TrackedDebPackage models with working getters', () => {
    const wire = new TrackedDebPackage({
      id: 2,
      name: 'thing',
      packageUrl: 'https://example.com/downloads/thing_1.0.0_amd64.deb',
      installedVersion: '1.0.0',
      latestVersion: '1.0.1',
      createdAt: new Date('2026-01-01T00:00:00Z')
    }).toMap()

    const [pkg] = rehydrateDebPackages([wire])

    expect(pkg).toBeInstanceOf(TrackedDebPackage)
    expect(pkg.effectiveDisplayName).toBe('thing')
    expect(pkg.filename).toBe('thing_1.0.0_amd64.deb')
    expect(pkg.hasUpdate).toBe(true)
  })
})
