// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { InstallType } from '../models/install-type'
import {
  choosePreferredAsset,
  groupAssetsByInstallType,
  type GithubAssetOption
} from './asset-options'

function asset(name: string, installType: string, size = 1000): GithubAssetOption {
  return { name, size, downloadUrl: `https://example.com/${name}`, installType }
}

describe('groupAssetsByInstallType', () => {
  it('groups installable assets by their install type, preserving first-seen order', () => {
    const groups = groupAssetsByInstallType([
      asset('app-amd64.deb', 'deb'),
      asset('app-arm64.deb', 'deb'),
      asset('app-x86_64.rpm', 'rpm')
    ])

    expect(groups.map((group) => group.installType)).toEqual([InstallType.deb, InstallType.rpm])
    expect(groups[0].assets.map((entry) => entry.name)).toEqual(['app-amd64.deb', 'app-arm64.deb'])
  })

  it('drops assets whose install type is not recognised', () => {
    const groups = groupAssetsByInstallType([
      asset('checksums.txt', ''),
      asset('app.deb', 'deb'),
      asset('weird.xyz', 'not-a-type')
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].assets.map((entry) => entry.name)).toEqual(['app.deb'])
  })

  it('returns an empty list when nothing is installable', () => {
    expect(groupAssetsByInstallType([])).toEqual([])
  })
})

describe('choosePreferredAsset', () => {
  it('returns null when there are no candidates', () => {
    expect(choosePreferredAsset([], [])).toBeNull()
  })

  it('returns the only candidate without asking', () => {
    const only = asset('app-amd64.deb', 'deb')
    expect(choosePreferredAsset([only], [])).toBe(only)
  })

  it('prefers an architecture-matching candidate', () => {
    const amd64 = asset('app-amd64.deb', 'deb')
    const arm64 = asset('app-arm64.deb', 'deb')
    expect(choosePreferredAsset([amd64, arm64], ['arm64'])).toBe(arm64)
  })

  it('returns null when several candidates match no requested architecture', () => {
    const amd64 = asset('app-amd64.deb', 'deb')
    const arm64 = asset('app-arm64.deb', 'deb')
    expect(choosePreferredAsset([amd64, arm64], ['riscv64'])).toBeNull()
    expect(choosePreferredAsset([amd64, arm64], [])).toBeNull()
  })
})
