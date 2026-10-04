// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import {
  NoArgs,
  SettingsSchema,
  TrackedAppSchema,
  TrackedDebPackageSchema,
  VersionSchema
} from '../main/ipc-schemas'

describe('NoArgs', () => {
  it('accepts an empty argument list', () => {
    expect(NoArgs.safeParse([]).success).toBe(true)
  })

  it('rejects a payload for a read-only method', () => {
    expect(NoArgs.safeParse([{ unexpected: true }]).success).toBe(false)
  })
})

describe('result schemas', () => {
  it('accepts a TrackedApp wire map produced by toMap()', () => {
    const app = new TrackedApp({
      id: 1,
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App',
      installedVersion: '1.0.0',
      latestVersion: '1.0.1',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    expect(TrackedAppSchema.safeParse(app.toMap()).success).toBe(true)
  })

  it('rejects a TrackedApp missing required fields', () => {
    expect(TrackedAppSchema.safeParse({ id: 1 }).success).toBe(false)
  })

  it('rejects a TrackedApp whose date is not an ISO instant', () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    expect(TrackedAppSchema.safeParse({ ...app.toMap(), created_at: 'not-a-date' }).success).toBe(
      false
    )
  })

  it('accepts a TrackedDebPackage wire map produced by toMap()', () => {
    const pkg = new TrackedDebPackage({
      id: 1,
      name: 'thing',
      packageUrl: 'https://example.com/thing.deb',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    expect(TrackedDebPackageSchema.safeParse(pkg.toMap()).success).toBe(true)
  })

  it('rejects a TrackedDebPackage missing required fields', () => {
    expect(TrackedDebPackageSchema.safeParse({ id: 1 }).success).toBe(false)
  })

  it('accepts a settings record and a version string', () => {
    expect(SettingsSchema.safeParse({ theme: 'dark', github_releases_per_page: 50 }).success).toBe(
      true
    )
    expect(VersionSchema.safeParse('0.1.0').success).toBe(true)
    expect(VersionSchema.safeParse(1).success).toBe(false)
  })
})
