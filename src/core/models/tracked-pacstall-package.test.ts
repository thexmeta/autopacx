// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

// Tests for `TrackedPacstallPackage`, the pacstall counterpart of
// `TrackedDebPackage`. The `hasUpdate` cases pin the shared version-ordering
// semantics; the wire round-trip pins the snake_case form.

import { describe, expect, it } from 'vitest'
import { TrackedPacstallPackage } from './tracked-pacstall-package'

describe('TrackedPacstallPackage.hasUpdate', () => {
  const pkg = (
    opts: { installed?: string | null; latest?: string | null } = {}
  ): TrackedPacstallPackage =>
    new TrackedPacstallPackage({
      name: 'neovim',
      registryRepo: 'pacstall/pacstall-programs',
      installedVersion: opts.installed,
      latestVersion: opts.latest,
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

  it('detects 1.9 -> 1.10 as newer (numeric, not lexicographic)', () => {
    expect(pkg({ installed: '1.9', latest: '1.10' }).hasUpdate).toBe(true)
  })

  it('is false when the installed version is newer', () => {
    expect(pkg({ installed: '1.10', latest: '1.9' }).hasUpdate).toBe(false)
  })

  it('ignores a leading v', () => {
    expect(pkg({ installed: '1.0.0', latest: 'v1.0.0' }).hasUpdate).toBe(false)
  })

  it('is false when either version is missing or equal', () => {
    expect(pkg({ installed: null, latest: '1.0.0' }).hasUpdate).toBe(false)
    expect(pkg({ installed: '1.0.0', latest: null }).hasUpdate).toBe(false)
    expect(pkg({ installed: '1.0.0', latest: '1.0.0' }).hasUpdate).toBe(false)
  })
})

describe('TrackedPacstallPackage wire round-trip', () => {
  it('fromMap(toMap(x)) preserves the getter-visible values', () => {
    const original = new TrackedPacstallPackage({
      id: 7,
      name: 'neovim',
      displayName: 'Neovim',
      description: 'Hyperextensible Vim-based text editor',
      maintainer: 'Jane Doe <jane@example.com>',
      installedVersion: '0.9.5',
      latestVersion: '0.10.0',
      packageName: 'neovim',
      launchCommand: 'nvim',
      autoUpdate: true,
      lastChecked: new Date('2026-02-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      registryRepo: 'pacstall/pacstall-programs'
    })

    const rehydrated = TrackedPacstallPackage.fromMap(original.toMap())

    expect(rehydrated.hasUpdate).toBe(true)
    expect(rehydrated.effectiveDisplayName).toBe('Neovim')
    expect(rehydrated.id).toBe(7)
    expect(rehydrated.name).toBe('neovim')
    expect(rehydrated.description).toBe('Hyperextensible Vim-based text editor')
    expect(rehydrated.maintainer).toBe('Jane Doe <jane@example.com>')
    expect(rehydrated.installedVersion).toBe('0.9.5')
    expect(rehydrated.latestVersion).toBe('0.10.0')
    expect(rehydrated.packageName).toBe('neovim')
    expect(rehydrated.launchCommand).toBe('nvim')
    expect(rehydrated.autoUpdate).toBe(true)
    expect(rehydrated.registryRepo).toBe('pacstall/pacstall-programs')
    expect(rehydrated.lastChecked?.getTime()).toBe(original.lastChecked?.getTime())
    expect(rehydrated.createdAt.getTime()).toBe(original.createdAt.getTime())
  })

  it('uses snake_case wire keys and falls back to the name for display', () => {
    const original = new TrackedPacstallPackage({
      name: 'neovim',
      registryRepo: 'pacstall/pacstall-programs',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    })

    const map = original.toMap()
    expect(Object.keys(map)).toContain('registry_repo')
    expect(Object.keys(map)).toContain('display_name')
    expect(Object.keys(map)).toContain('installed_version')
    expect(TrackedPacstallPackage.fromMap(map).effectiveDisplayName).toBe('neovim')
  })
})

describe('TrackedPacstallPackage.copyWith', () => {
  const original = new TrackedPacstallPackage({
    id: 1,
    name: 'neovim',
    displayName: 'Neovim',
    installedVersion: '0.9.5',
    latestVersion: '0.10.0',
    autoUpdate: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    registryRepo: 'pacstall/pacstall-programs'
  })

  it('replaces only the supplied fields', () => {
    const updated = original.copyWith({ latestVersion: '0.11.0', autoUpdate: true })
    expect(updated.latestVersion).toBe('0.11.0')
    expect(updated.autoUpdate).toBe(true)
    expect(updated.name).toBe('neovim')
    expect(updated.installedVersion).toBe('0.9.5')
  })

  it('can clear a nullable field explicitly', () => {
    expect(original.copyWith({ displayName: null }).displayName).toBeNull()
  })
})
