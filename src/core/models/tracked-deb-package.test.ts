// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

// Ported 1:1 from `test/models/tracked_deb_package_test.dart`.

// These tests pin down `TrackedDebPackage.hasUpdate` version-ordering
// semantics. They deliberately encode *why* each case matters (numeric vs
// lexicographic ordering, `v` prefixes, Debian revisions) so a regression in
// the shared comparison logic fails loudly instead of silently.

import { describe, expect, it } from 'vitest'
import { TrackedDebPackage } from './tracked-deb-package'

describe('TrackedDebPackage.hasUpdate', () => {
  const pkg = (
    opts: { installed?: string | null; latest?: string | null } = {}
  ): TrackedDebPackage =>
    new TrackedDebPackage({
      name: 'app',
      packageUrl: 'https://example.com/app.deb',
      installedVersion: opts.installed,
      latestVersion: opts.latest,
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

  it('detects 1.9 -> 1.10 as newer (numeric, not lexicographic)', () => {
    // Lexicographic string compare would rank "1.10" < "1.9", so this is the
    // canonical multi-digit regression case.
    expect(pkg({ installed: '1.9', latest: '1.10' }).hasUpdate).toBe(true)
  })

  it('is false for 1.10 -> 1.9 (installed version is newer)', () => {
    expect(pkg({ installed: '1.10', latest: '1.9' }).hasUpdate).toBe(false)
  })

  it('ignores a leading v so v1.0.0 is not newer than 1.0.0', () => {
    expect(pkg({ installed: '1.0.0', latest: 'v1.0.0' }).hasUpdate).toBe(false)
    expect(pkg({ installed: 'v1.0.0', latest: '1.0.0' }).hasUpdate).toBe(false)
  })

  it('detects a Debian revision bump (1.0.0-1 -> 1.0.0-2)', () => {
    expect(pkg({ installed: '1.0.0-1', latest: '1.0.0-2' }).hasUpdate).toBe(true)
  })

  it('is false for a Debian revision downgrade (1.0.0-2 -> 1.0.0-1)', () => {
    expect(pkg({ installed: '1.0.0-2', latest: '1.0.0-1' }).hasUpdate).toBe(false)
  })

  it('returns false when versions are equal', () => {
    expect(pkg({ installed: '1.0.0', latest: '1.0.0' }).hasUpdate).toBe(false)
  })

  it('returns false when installedVersion or latestVersion is null', () => {
    expect(pkg({ installed: null, latest: '1.0.0' }).hasUpdate).toBe(false)
    expect(pkg({ installed: '1.0.0', latest: null }).hasUpdate).toBe(false)
  })

  it('treats a release as newer than its prerelease', () => {
    expect(pkg({ installed: '1.0.0-alpha', latest: '1.0.0' }).hasUpdate).toBe(true)
    expect(pkg({ installed: '1.0.0', latest: '1.0.0-alpha' }).hasUpdate).toBe(false)
  })
})

describe('wire round-trip', () => {
  it('fromMap(toMap(x)) preserves the getter-visible values', () => {
    const original = new TrackedDebPackage({
      id: 3,
      name: 'app',
      packageUrl: 'https://example.com/downloads/app_1.2.3_amd64.deb',
      displayName: 'My App',
      installedVersion: '1.2.3',
      latestVersion: '1.2.4',
      fileSize: '12 MB',
      fileDate: new Date('2026-02-01T00:00:00.000Z'),
      lastChecked: new Date('2026-02-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      checksum: 'abc',
      autoUpdate: true,
      packageName: 'app',
      launchCommand: 'app'
    })

    const rehydrated = TrackedDebPackage.fromMap(original.toMap())

    // Getters lost by Electron's structured clone must work again.
    expect(rehydrated.hasUpdate).toBe(true)
    expect(rehydrated.filename).toBe('app_1.2.3_amd64.deb')
    expect(rehydrated.effectiveDisplayName).toBe('My App')
    // Data fields survive the snake_case wire form.
    expect(rehydrated.id).toBe(3)
    expect(rehydrated.packageUrl).toBe(original.packageUrl)
    expect(rehydrated.installedVersion).toBe('1.2.3')
    expect(rehydrated.latestVersion).toBe('1.2.4')
    expect(rehydrated.fileSize).toBe('12 MB')
    expect(rehydrated.autoUpdate).toBe(true)
    expect(rehydrated.fileDate?.getTime()).toBe(original.fileDate?.getTime())
    expect(rehydrated.createdAt.getTime()).toBe(original.createdAt.getTime())
  })

  it('falls back to the name when no display name is set', () => {
    const original = new TrackedDebPackage({
      name: 'app',
      packageUrl: 'https://example.com/app.deb',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    })

    expect(TrackedDebPackage.fromMap(original.toMap()).effectiveDisplayName).toBe('app')
  })
})
