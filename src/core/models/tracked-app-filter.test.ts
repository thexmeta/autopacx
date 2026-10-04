// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

// Ported 1:1 from `test/models/tracked_app_filter_test.dart`.

import { describe, expect, it } from 'vitest'
import { TrackedApp } from './tracked-app'

describe('TrackedApp isValidFilterPattern', () => {
  it('accepts null or empty', () => {
    expect(TrackedApp.isValidFilterPattern(null)).toBe(true)
    expect(TrackedApp.isValidFilterPattern('')).toBe(true)
  })

  it('accepts valid patterns with wildcard', () => {
    expect(TrackedApp.isValidFilterPattern('*.deb')).toBe(true)
    expect(TrackedApp.isValidFilterPattern('app*.deb')).toBe(true)
    expect(TrackedApp.isValidFilterPattern('*.tar.gz')).toBe(true)
  })

  it('accepts valid patterns with question mark', () => {
    expect(TrackedApp.isValidFilterPattern('app?.deb')).toBe(true)
    expect(TrackedApp.isValidFilterPattern('app??.deb')).toBe(true)
  })

  it('accepts patterns with file extension', () => {
    expect(TrackedApp.isValidFilterPattern('app.deb')).toBe(true)
    expect(TrackedApp.isValidFilterPattern('MyApp.tar.gz')).toBe(true)
  })

  it('accepts literal filenames', () => {
    expect(TrackedApp.isValidFilterPattern('abc')).toBe(true)
    expect(TrackedApp.isValidFilterPattern('123')).toBe(true)
    expect(TrackedApp.isValidFilterPattern('appimage')).toBe(true)
  })

  it('rejects whitespace-only patterns', () => {
    expect(TrackedApp.isValidFilterPattern('   ')).toBe(false)
  })
})

describe('TrackedApp isValidTagPrefix', () => {
  it('accepts null or empty', () => {
    expect(TrackedApp.isValidTagPrefix(null)).toBe(true)
    expect(TrackedApp.isValidTagPrefix('')).toBe(true)
  })

  it('accepts alphanumeric prefixes', () => {
    expect(TrackedApp.isValidTagPrefix('v')).toBe(true)
    expect(TrackedApp.isValidTagPrefix('release')).toBe(true)
    expect(TrackedApp.isValidTagPrefix('v1')).toBe(true)
    expect(TrackedApp.isValidTagPrefix('app-v1')).toBe(true)
  })

  it('accepts hyphens and underscores', () => {
    expect(TrackedApp.isValidTagPrefix('app-v1')).toBe(true)
    expect(TrackedApp.isValidTagPrefix('release_tag')).toBe(true)
    expect(TrackedApp.isValidTagPrefix('my-prefix_test')).toBe(true)
  })

  it('rejects special characters', () => {
    expect(TrackedApp.isValidTagPrefix('v*')).toBe(false)
    expect(TrackedApp.isValidTagPrefix('app@v1')).toBe(false)
    expect(TrackedApp.isValidTagPrefix('release!')).toBe(false)
    expect(TrackedApp.isValidTagPrefix('test#')).toBe(false)
    expect(TrackedApp.isValidTagPrefix('app/v1')).toBe(false)
  })
})

describe('TrackedApp validateFilterSettings', () => {
  it('returns null for valid settings', () => {
    expect(
      TrackedApp.validateFilterSettings({ assetFilterPattern: '*.deb', tagPrefix: 'v' })
    ).toBeNull()
  })

  it('returns null for literal filename pattern', () => {
    expect(TrackedApp.validateFilterSettings({ assetFilterPattern: 'appimage' })).toBeNull()
  })

  it('returns error for whitespace-only pattern', () => {
    const result = TrackedApp.validateFilterSettings({ assetFilterPattern: '   ' })
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid asset filter pattern')
  })

  it('returns error for invalid tag prefix', () => {
    const result = TrackedApp.validateFilterSettings({ tagPrefix: 'v*' })
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid tag prefix')
  })
})

describe('TrackedApp serialization', () => {
  it('toMap includes filter fields', () => {
    const app = new TrackedApp({
      id: 1,
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64', 'arm64'],
      includePrerelease: true
    })

    const map = app.toMap()
    expect(map['asset_filter_pattern']).toBe('*.deb')
    expect(map['tag_prefix']).toBe('v')
    expect(map['architectures']).toEqual(['amd64', 'arm64'])
    expect(map['include_prerelease']).toBe(true)
  })

  it('fromMap parses filter fields', () => {
    const map: Record<string, unknown> = {
      id: 1,
      repo_owner: 'owner',
      repo_name: 'repo',
      display_name: 'Test App',
      created_at: '2026-01-01T00:00:00Z',
      asset_filter_pattern: '*.deb',
      tag_prefix: 'v',
      architectures: ['amd64', 'arm64'],
      include_prerelease: true
    }

    const app = TrackedApp.fromMap(map)
    expect(app.assetFilterPattern).toBe('*.deb')
    expect(app.tagPrefix).toBe('v')
    expect(app.architectures).toEqual(['amd64', 'arm64'])
    expect(app.includePrerelease).toBe(true)
  })

  it('fromMap handles missing filter fields', () => {
    const map: Record<string, unknown> = {
      id: 1,
      repo_owner: 'owner',
      repo_name: 'repo',
      display_name: 'Test App',
      created_at: '2026-01-01T00:00:00Z'
    }

    const app = TrackedApp.fromMap(map)
    expect(app.assetFilterPattern).toBeNull()
    expect(app.tagPrefix).toBeNull()
    expect(app.architectures).toEqual([])
    expect(app.includePrerelease).toBe(false)
  })

  it('copyWith updates filter fields', () => {
    const original = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    const updated = original.copyWith({
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64'],
      includePrerelease: true
    })

    expect(updated.assetFilterPattern).toBe('*.deb')
    expect(updated.tagPrefix).toBe('v')
    expect(updated.architectures).toEqual(['amd64'])
    expect(updated.includePrerelease).toBe(true)

    expect(original.assetFilterPattern).toBeNull()
    expect(original.tagPrefix).toBeNull()
    expect(original.architectures).toEqual([])
    expect(original.includePrerelease).toBe(false)
  })
})

describe('TrackedApp constructor', () => {
  it('initializes architectures to empty list if null', () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      architectures: null
    })
    expect(app.architectures).toEqual([])
  })

  it('initializes includePrerelease to false by default', () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })
    expect(app.includePrerelease).toBe(false)
  })
})
