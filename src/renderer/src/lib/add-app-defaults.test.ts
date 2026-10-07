// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { DEFAULT_ARCH_TYPES, type MaskedSettings } from '@core/index'
import {
  addAppDefaults,
  configuredAssetFilterPattern,
  defaultArchitecture,
  defaultArchitectures,
  defaultArchTypes,
  defaultAssetFilterPattern,
  defaultInstallType
} from './add-app-defaults'

function settings(overrides: Partial<MaskedSettings> = {}): MaskedSettings {
  return { hasGithubToken: false, ...overrides }
}

describe('defaultArchitecture', () => {
  it('returns an empty string when settings are absent or unset', () => {
    expect(defaultArchitecture(undefined)).toBe('')
    expect(defaultArchitecture(settings())).toBe('')
  })

  it('returns the trimmed configured architecture', () => {
    expect(defaultArchitecture(settings({ default_architecture: ' amd64 ' }))).toBe('amd64')
  })
})

describe('defaultArchitectures', () => {
  it('returns the configured list, trimmed and without empty entries', () => {
    expect(
      defaultArchitectures(settings({ default_architectures: [' amd64 ', '', 'arm64'] }))
    ).toEqual(['amd64', 'arm64'])
  })

  it('falls back to the legacy single default_architecture key', () => {
    expect(defaultArchitectures(settings({ default_architecture: 'arm64' }))).toEqual(['arm64'])
  })

  it('returns an empty list when nothing is configured', () => {
    expect(defaultArchitectures(undefined)).toEqual([])
    expect(defaultArchitectures(settings({ default_architectures: [] }))).toEqual([])
  })
})

describe('defaultArchTypes', () => {
  it('returns the configured architecture types', () => {
    expect(defaultArchTypes(settings({ default_arch_type: ['riscv64', 'loongarch64'] }))).toEqual([
      'riscv64',
      'loongarch64'
    ])
  })

  it('falls back to the built-in architecture types when unset', () => {
    expect(defaultArchTypes(undefined)).toEqual([...DEFAULT_ARCH_TYPES])
    expect(defaultArchTypes(settings({ default_arch_type: [] }))).toEqual([...DEFAULT_ARCH_TYPES])
  })
})

describe('defaultInstallType', () => {
  it('returns the configured install type', () => {
    expect(defaultInstallType(settings({ default_install_type: 'deb' }))).toBe('deb')
  })

  it('returns an empty string (unspecified) when unset', () => {
    expect(defaultInstallType(undefined)).toBe('')
    expect(defaultInstallType(settings())).toBe('')
  })
})

describe('defaultAssetFilterPattern', () => {
  it('uses *.deb for a deb install regardless of architecture', () => {
    expect(defaultAssetFilterPattern('deb', 'amd64')).toBe('*.deb')
    expect(defaultAssetFilterPattern('deb', '')).toBe('*.deb')
  })

  it('uses *<arch>* for any other install type', () => {
    expect(defaultAssetFilterPattern('binary', 'arm64')).toBe('*arm64*')
    expect(defaultAssetFilterPattern('', 'amd64')).toBe('*amd64*')
  })

  it('falls back to * when no architecture is known', () => {
    expect(defaultAssetFilterPattern('binary', '')).toBe('*')
  })
})

describe('configuredAssetFilterPattern', () => {
  it('prefers the configured asset filter pattern', () => {
    expect(
      configuredAssetFilterPattern(
        settings({ default_asset_filter_pattern: ' *linux* ' }),
        'deb',
        'amd64'
      )
    ).toBe('*linux*')
  })

  it('derives the pattern from the install type when unset', () => {
    expect(configuredAssetFilterPattern(undefined, 'deb', 'amd64')).toBe('*.deb')
    expect(configuredAssetFilterPattern(settings(), '', 'arm64')).toBe('*arm64*')
  })
})

describe('addAppDefaults', () => {
  it('seeds the architecture and a matching asset filter', () => {
    expect(addAppDefaults(settings({ default_architecture: 'amd64' }))).toEqual({
      architectures: ['amd64'],
      installType: '',
      archTypes: [...DEFAULT_ARCH_TYPES],
      assetFilterPattern: '*amd64*'
    })
  })

  it('seeds no architecture and a wildcard filter when settings are absent', () => {
    expect(addAppDefaults(undefined)).toEqual({
      architectures: [],
      installType: '',
      archTypes: [...DEFAULT_ARCH_TYPES],
      assetFilterPattern: '*'
    })
  })

  it('seeds all four add-app defaults from settings', () => {
    expect(
      addAppDefaults(
        settings({
          default_architectures: ['amd64', 'arm64'],
          default_install_type: 'deb',
          default_arch_type: ['amd64', 'arm64'],
          default_asset_filter_pattern: '*.deb'
        })
      )
    ).toEqual({
      architectures: ['amd64', 'arm64'],
      installType: 'deb',
      archTypes: ['amd64', 'arm64'],
      assetFilterPattern: '*.deb'
    })
  })

  it('derives the filter from the configured install type and primary architecture', () => {
    expect(addAppDefaults(settings({ default_install_type: 'binary', default_architectures: ['arm64'] })))
      .toEqual({
        architectures: ['arm64'],
        installType: 'binary',
        archTypes: [...DEFAULT_ARCH_TYPES],
        assetFilterPattern: '*arm64*'
      })
  })

  it('changes the seeded defaults when a setting changes', () => {
    const before = addAppDefaults(settings({ default_install_type: 'deb' }))
    const after = addAppDefaults(settings({ default_install_type: 'binary', default_architectures: ['amd64'] }))

    expect(before.assetFilterPattern).toBe('*.deb')
    expect(after.assetFilterPattern).toBe('*amd64*')
    expect(before.installType).toBe('deb')
    expect(after.installType).toBe('binary')
  })
})
