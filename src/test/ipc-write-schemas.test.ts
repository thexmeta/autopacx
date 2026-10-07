// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import {
  AddAppArgsSchema,
  AddDebPackageArgsSchema,
  AddPacstallPackageArgsSchema,
  AppArgSchema,
  AppArgWithOptionsSchema,
  BatchDeleteSummarySchema,
  BatchItemsArgsSchema,
  BatchOperationResultSchema,
  BatchUpdateResultSchema,
  BooleanSchema,
  DebugLogResultSchema,
  DebArgSchema,
  ExportResultSchema,
  GetGithubReleaseAssetsArgsSchema,
  GetInstallTargetsArgsSchema,
  GetInstallTargetsResultSchema,
  GetPacstallIndexArgsSchema,
  GitHubRepoSearchResultSchema,
  GithubAssetOptionSchema,
  GithubReleaseAssetsResultSchema,
  IdArgSchema,
  IdResultSchema,
  IdsArgSchema,
  ImportResultSchema,
  InstallOptionsSchema,
  InstallTargetSuggestionSchema,
  MaskedSettingsSchema,
  NullableVersionSchema,
  OpenExternalArgsSchema,
  PacstallArgSchema,
  PacstallBatchUpdateResultSchema,
  PacstallIndexSchema,
  PacstallNameArgSchema,
  PacstallPackageInfoSchema,
  PacstallStatusSchema,
  SearchGithubRepositoriesArgsSchema,
  SetGithubTokenArgsSchema,
  SetSettingsArgsSchema,
  TrackedPacstallPackageSchema,
  VoidSchema
} from '../main/ipc-schemas'

const appMap = new TrackedApp({
  id: 1,
  repoOwner: 'owner',
  repoName: 'repo',
  displayName: 'App',
  createdAt: new Date('2026-01-01T00:00:00Z')
}).toMap()

const debMap = new TrackedDebPackage({
  id: 1,
  name: 'thing',
  packageUrl: 'https://example.com/thing.deb',
  createdAt: new Date('2026-01-01T00:00:00Z')
}).toMap()

const pacstallMap = new TrackedPacstallPackage({
  id: 1,
  name: 'neovim',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  registryRepo: 'pacstall/pacstall-programs'
}).toMap()

describe('request schemas — single object arguments', () => {
  it('accepts a tracked-app wire map and rejects a malformed one', () => {
    expect(AppArgSchema.safeParse([appMap]).success).toBe(true)
    expect(AppArgSchema.safeParse([{ id: 1 }]).success).toBe(false)
    expect(AppArgSchema.safeParse([]).success).toBe(false)
  })

  it('accepts install options as an optional second element', () => {
    expect(AppArgWithOptionsSchema.safeParse([appMap]).success).toBe(true)
    expect(
      AppArgWithOptionsSchema.safeParse([appMap, { targetPath: '/usr/bin/x', binaryName: 'x' }])
        .success
    ).toBe(true)
    expect(AppArgWithOptionsSchema.safeParse([appMap, { targetPath: 5 }]).success).toBe(false)
  })

  it('accepts a tracked-deb wire map and rejects a malformed one', () => {
    expect(DebArgSchema.safeParse([debMap]).success).toBe(true)
    expect(DebArgSchema.safeParse([{ name: 'x' }]).success).toBe(false)
  })

  it('validates the install options shape', () => {
    expect(InstallOptionsSchema.safeParse({ targetPath: null, binaryName: null }).success).toBe(
      true
    )
    expect(InstallOptionsSchema.safeParse({ assetName: 'app-amd64.deb' }).success).toBe(true)
    expect(InstallOptionsSchema.safeParse({ assetName: null }).success).toBe(true)
    expect(InstallOptionsSchema.safeParse({ assetName: 5 }).success).toBe(false)
    expect(InstallOptionsSchema.safeParse({ targetPath: 1 }).success).toBe(false)
  })
})

describe('request schemas — id arguments', () => {
  it('accepts an integer id and rejects non-integers', () => {
    expect(IdArgSchema.safeParse([3]).success).toBe(true)
    expect(IdArgSchema.safeParse([3.5]).success).toBe(false)
    expect(IdArgSchema.safeParse(['3']).success).toBe(false)
  })

  it('accepts three id lists', () => {
    expect(IdsArgSchema.safeParse([[1, 2], [3], [4]]).success).toBe(true)
    expect(IdsArgSchema.safeParse([[1, 2], [3]]).success).toBe(false)
    expect(IdsArgSchema.safeParse([[1], ['x'], []]).success).toBe(false)
  })
})

describe('request schemas — token and settings', () => {
  it('accepts a token string', () => {
    expect(SetGithubTokenArgsSchema.safeParse(['ghp_x']).success).toBe(true)
    expect(SetGithubTokenArgsSchema.safeParse([1]).success).toBe(false)
  })

  it('accepts an https URL to open and rejects other schemes', () => {
    expect(OpenExternalArgsSchema.safeParse(['https://github.com/o/r']).success).toBe(true)
    expect(OpenExternalArgsSchema.safeParse(['http://github.com/o/r']).success).toBe(false)
    expect(OpenExternalArgsSchema.safeParse(['file:///etc/passwd']).success).toBe(false)
    expect(OpenExternalArgsSchema.safeParse([]).success).toBe(false)
    expect(OpenExternalArgsSchema.safeParse([123]).success).toBe(false)
  })

  it('accepts a settings record', () => {
    expect(SetSettingsArgsSchema.safeParse([{ theme: 'dark' }]).success).toBe(true)
    expect(SetSettingsArgsSchema.safeParse(['nope']).success).toBe(false)
  })
})

describe('request schemas — add inputs', () => {
  it('accepts a valid addApp input and rejects blank required fields', () => {
    expect(
      AddAppArgsSchema.safeParse([{ repoOwner: 'o', repoName: 'r', displayName: 'D' }]).success
    ).toBe(true)
    expect(
      AddAppArgsSchema.safeParse([{ repoOwner: '', repoName: 'r', displayName: 'D' }]).success
    ).toBe(false)
  })

  it('accepts a known installType and rejects an unknown one', () => {
    expect(
      AddAppArgsSchema.safeParse([
        { repoOwner: 'o', repoName: 'r', displayName: 'D', installType: 'binary' }
      ]).success
    ).toBe(true)
    expect(
      AddAppArgsSchema.safeParse([
        { repoOwner: 'o', repoName: 'r', displayName: 'D', installType: 'not-a-type' }
      ]).success
    ).toBe(false)
    expect(
      AddAppArgsSchema.safeParse([
        { repoOwner: 'o', repoName: 'r', displayName: 'D', installType: null }
      ]).success
    ).toBe(true)
  })

  it('accepts a valid addDebPackage input and rejects a blank or non-HTTPS url', () => {
    expect(
      AddDebPackageArgsSchema.safeParse([{ name: 'n', packageUrl: 'https://x/y.deb' }]).success
    ).toBe(true)
    expect(AddDebPackageArgsSchema.safeParse([{ name: 'n', packageUrl: '' }]).success).toBe(false)
    // A package is downloaded and installed as root, so plaintext is refused.
    expect(
      AddDebPackageArgsSchema.safeParse([{ name: 'n', packageUrl: 'http://x/y.deb' }]).success
    ).toBe(false)
    expect(
      AddDebPackageArgsSchema.safeParse([{ name: 'n', packageUrl: 'ftp://x/y.deb' }]).success
    ).toBe(false)
    expect(
      AddDebPackageArgsSchema.safeParse([{ name: 'n', packageUrl: 'not a url' }]).success
    ).toBe(false)
  })
})

describe('request schemas — batch arguments', () => {
  it('accepts three lists of wire maps', () => {
    expect(BatchItemsArgsSchema.safeParse([[appMap], [debMap], [pacstallMap]]).success).toBe(true)
    expect(BatchItemsArgsSchema.safeParse([[appMap], [debMap]]).success).toBe(false)
    expect(BatchItemsArgsSchema.safeParse([[appMap], 'nope', []]).success).toBe(false)
  })
})

describe('request schemas — pacstall and GitHub search', () => {
  it('accepts a tracked pacstall wire map and rejects a malformed one', () => {
    expect(PacstallArgSchema.safeParse([pacstallMap]).success).toBe(true)
    expect(PacstallArgSchema.safeParse([{ name: 'neovim' }]).success).toBe(false)
    expect(PacstallArgSchema.safeParse([]).success).toBe(false)
  })

  it('validates the pacstall name argument', () => {
    expect(PacstallNameArgSchema.safeParse([{ name: 'neovim' }]).success).toBe(true)
    expect(PacstallNameArgSchema.safeParse([{ name: '' }]).success).toBe(false)
    expect(PacstallNameArgSchema.safeParse([{}]).success).toBe(false)
  })

  it('validates the addPacstallPackage input', () => {
    expect(AddPacstallPackageArgsSchema.safeParse([{ name: 'neovim' }]).success).toBe(true)
    expect(
      AddPacstallPackageArgsSchema.safeParse([{ name: 'neovim', displayName: 'Neovim' }]).success
    ).toBe(true)
    expect(AddPacstallPackageArgsSchema.safeParse([{ name: '' }]).success).toBe(false)
  })

  it('accepts an optional force flag for the index', () => {
    expect(GetPacstallIndexArgsSchema.safeParse([]).success).toBe(true)
    expect(GetPacstallIndexArgsSchema.safeParse([{}]).success).toBe(true)
    expect(GetPacstallIndexArgsSchema.safeParse([{ force: true }]).success).toBe(true)
    expect(GetPacstallIndexArgsSchema.safeParse([{ force: 'yes' }]).success).toBe(false)
  })

  it('validates the GitHub search arguments and sort enum', () => {
    expect(SearchGithubRepositoriesArgsSchema.safeParse([{ query: 'pacstall' }]).success).toBe(true)
    expect(
      SearchGithubRepositoriesArgsSchema.safeParse([
        { query: 'pacstall', page: 2, perPage: 10, sort: 'stars' }
      ]).success
    ).toBe(true)
    expect(SearchGithubRepositoriesArgsSchema.safeParse([{ query: '' }]).success).toBe(false)
    expect(
      SearchGithubRepositoriesArgsSchema.safeParse([{ query: 'x', sort: 'nope' }]).success
    ).toBe(false)
    expect(SearchGithubRepositoriesArgsSchema.safeParse([{ query: 'x', page: 0 }]).success).toBe(
      false
    )
  })

  it('clamps perPage above the GitHub 100 cap instead of rejecting it', () => {
    const parsed = SearchGithubRepositoriesArgsSchema.safeParse([{ query: 'x', perPage: 250 }])
    expect(parsed.success).toBe(true)
    expect(parsed.success ? parsed.data[0].perPage : null).toBe(100)

    const atCap = SearchGithubRepositoriesArgsSchema.safeParse([{ query: 'x', perPage: 100 }])
    expect(atCap.success ? atCap.data[0].perPage : null).toBe(100)

    const belowCap = SearchGithubRepositoriesArgsSchema.safeParse([{ query: 'x', perPage: 30 }])
    expect(belowCap.success ? belowCap.data[0].perPage : null).toBe(30)
  })

  it('validates the release-asset lookup arguments', () => {
    expect(
      GetGithubReleaseAssetsArgsSchema.safeParse([{ repoOwner: 'o', repoName: 'r' }]).success
    ).toBe(true)
    expect(
      GetGithubReleaseAssetsArgsSchema.safeParse([
        { repoOwner: 'o', repoName: 'r', includePrerelease: true }
      ]).success
    ).toBe(true)
    expect(
      GetGithubReleaseAssetsArgsSchema.safeParse([{ repoOwner: '', repoName: 'r' }]).success
    ).toBe(false)
    expect(GetGithubReleaseAssetsArgsSchema.safeParse([{ repoOwner: 'o' }]).success).toBe(false)
    expect(
      GetGithubReleaseAssetsArgsSchema.safeParse([{ repoOwner: 'o', repoName: 'r', x: 1 }]).success
    ).toBe(true)
  })

  it('accepts the optional release-asset filters', () => {
    expect(
      GetGithubReleaseAssetsArgsSchema.safeParse([
        {
          repoOwner: 'o',
          repoName: 'r',
          assetFilterPattern: '*.deb',
          tagPrefix: 'v',
          architectures: ['amd64', 'arm64']
        }
      ]).success
    ).toBe(true)
  })

  it('validates the install-target lookup arguments', () => {
    expect(GetInstallTargetsArgsSchema.safeParse([{ name: 'myapp' }]).success).toBe(true)
    expect(
      GetInstallTargetsArgsSchema.safeParse([{ name: 'myapp', installType: 'binary' }]).success
    ).toBe(true)
    expect(
      GetInstallTargetsArgsSchema.safeParse([{ name: 'myapp', installType: null }]).success
    ).toBe(true)
    expect(GetInstallTargetsArgsSchema.safeParse([{ name: '' }]).success).toBe(false)
    expect(
      GetInstallTargetsArgsSchema.safeParse([{ name: 'myapp', installType: 'nope' }]).success
    ).toBe(false)
  })
})

describe('result schemas', () => {
  it('accepts a masked settings map and requires the flag', () => {
    expect(MaskedSettingsSchema.safeParse({ hasGithubToken: true, theme: 'dark' }).success).toBe(
      true
    )
    expect(MaskedSettingsSchema.safeParse({ theme: 'dark' }).success).toBe(false)
  })

  it('validates the scalar results', () => {
    expect(BooleanSchema.safeParse(true).success).toBe(true)
    expect(VoidSchema.safeParse(undefined).success).toBe(true)
    expect(IdResultSchema.safeParse(5).success).toBe(true)
    expect(NullableVersionSchema.safeParse(null).success).toBe(true)
    expect(NullableVersionSchema.safeParse('1.0.0').success).toBe(true)
  })

  it('validates a batch operation result', () => {
    expect(
      BatchOperationResultSchema.safeParse({
        appName: 'App',
        success: true,
        error: null,
        newVersion: '2.0.0'
      }).success
    ).toBe(true)
    expect(BatchOperationResultSchema.safeParse({ appName: 'App' }).success).toBe(false)
  })

  it('validates the batch update result and delete summary', () => {
    expect(
      BatchUpdateResultSchema.safeParse({
        apps: [appMap],
        debPackages: [debMap],
        pacstallPackages: [pacstallMap],
        failures: []
      }).success
    ).toBe(true)
    expect(
      BatchUpdateResultSchema.safeParse({
        apps: [],
        debPackages: [],
        pacstallPackages: [],
        failures: [{ name: 'Broken', error: 'offline' }]
      }).success
    ).toBe(true)
    // The failure list is part of the contract: a result without it is invalid.
    expect(
      BatchUpdateResultSchema.safeParse({
        apps: [appMap],
        debPackages: [debMap],
        pacstallPackages: []
      }).success
    ).toBe(false)
    // The pacstall list is part of the contract too.
    expect(
      BatchUpdateResultSchema.safeParse({ apps: [], debPackages: [], failures: [] }).success
    ).toBe(false)
    expect(
      BatchUpdateResultSchema.safeParse({
        apps: [],
        debPackages: [],
        pacstallPackages: [],
        failures: [{ name: 'Broken' }]
      }).success
    ).toBe(false)
    expect(BatchDeleteSummarySchema.safeParse({ succeeded: 1, failed: 0 }).success).toBe(true)
    expect(BatchDeleteSummarySchema.safeParse({ succeeded: 1.5, failed: 0 }).success).toBe(false)
  })

  it('validates the export/import results', () => {
    expect(ExportResultSchema.safeParse({ path: '/data/x.json' }).success).toBe(true)
    expect(ImportResultSchema.safeParse({ count: 2 }).success).toBe(true)
    expect(ImportResultSchema.safeParse({ count: 'x' }).success).toBe(false)
  })

  it('validates the debug log result', () => {
    expect(DebugLogResultSchema.safeParse({ content: 'log', truncated: false }).success).toBe(true)
    expect(DebugLogResultSchema.safeParse({ content: 'log' }).success).toBe(false)
    expect(DebugLogResultSchema.safeParse({ content: 1, truncated: false }).success).toBe(false)
  })
})

describe('result schemas — pacstall and GitHub search', () => {
  it('validates the pacstall status result', () => {
    expect(
      PacstallStatusSchema.safeParse({
        installed: true,
        version: '6.2.0',
        path: '/usr/bin/pacstall',
        pathUnexpected: false,
        enabled: true
      }).success
    ).toBe(true)
    // `enabled` is part of the contract.
    expect(
      PacstallStatusSchema.safeParse({
        installed: false,
        version: null,
        path: null,
        pathUnexpected: false
      }).success
    ).toBe(false)
  })

  it('validates the pacstall index result', () => {
    expect(
      PacstallIndexSchema.safeParse({
        names: ['neovim'],
        fetchedAt: '2026-01-01T00:00:00Z',
        fromCache: true
      }).success
    ).toBe(true)
    expect(
      PacstallIndexSchema.safeParse({ names: ['neovim'], fetchedAt: 'nope', fromCache: true })
        .success
    ).toBe(false)
  })

  it('validates a parsed .SRCINFO document', () => {
    expect(
      PacstallPackageInfoSchema.safeParse({
        pkgname: 'neovim',
        pkgver: '0.10.0',
        pkgdesc: 'Vim fork',
        arch: ['amd64'],
        depends: [],
        optdepends: [],
        makedepends: [],
        maintainer: 'me',
        url: 'https://example.com',
        license: ['MIT'],
        source: [],
        sha256sums: []
      }).success
    ).toBe(true)
    expect(PacstallPackageInfoSchema.safeParse({ pkgname: 'neovim' }).success).toBe(false)
  })

  it('validates a tracked pacstall wire map', () => {
    expect(TrackedPacstallPackageSchema.safeParse(pacstallMap).success).toBe(true)
    expect(TrackedPacstallPackageSchema.safeParse({ id: 1 }).success).toBe(false)
  })

  it('validates the pacstall-only update result', () => {
    expect(
      PacstallBatchUpdateResultSchema.safeParse({
        packages: [pacstallMap],
        failures: [{ name: 'Broken', error: 'offline' }]
      }).success
    ).toBe(true)
    expect(PacstallBatchUpdateResultSchema.safeParse({ packages: [pacstallMap] }).success).toBe(
      false
    )
  })

  it('validates a release-assets result', () => {
    expect(
      GithubReleaseAssetsResultSchema.safeParse({
        tagName: 'v1.0.0',
        assets: [
          {
            name: 'app-amd64.deb',
            size: 42,
            downloadUrl: 'https://example.com/app-amd64.deb',
            installType: 'deb'
          }
        ],
        publishedAt: '2026-01-01T00:00:00Z'
      }).success
    ).toBe(true)
    expect(
      GithubReleaseAssetsResultSchema.safeParse({
        tagName: null,
        assets: [],
        publishedAt: null
      }).success
    ).toBe(true)
    // `publishedAt` is part of the wire contract and now required: the service
    // always populates it, so a result missing it is rejected.
    expect(GithubReleaseAssetsResultSchema.safeParse({ tagName: null, assets: [] }).success).toBe(
      false
    )
    // An unknown install type is rejected: the wire only carries real formats.
    expect(
      GithubReleaseAssetsResultSchema.safeParse({
        tagName: 'v1.0.0',
        assets: [{ name: 'a', size: 1, downloadUrl: 'https://x/a', installType: 'nope' }],
        publishedAt: null
      }).success
    ).toBe(false)
    expect(
      GithubAssetOptionSchema.safeParse({
        name: 'a',
        size: 1,
        downloadUrl: 'https://x/a',
        installType: 'deb'
      }).success
    ).toBe(true)
    expect(GithubAssetOptionSchema.safeParse({ name: 'a' }).success).toBe(false)
  })

  it('accepts the extended release-assets result fields', () => {
    expect(
      GithubReleaseAssetsResultSchema.safeParse({
        tagName: 'v1.0.0',
        assets: [],
        publishedAt: '2026-01-01T00:00:00Z',
        matchedNames: ['app.deb'],
        totalAssets: 3
      }).success
    ).toBe(true)
  })

  it('validates an install-target suggestion result', () => {
    expect(
      InstallTargetSuggestionSchema.safeParse({
        path: '/home/u/.local/bin',
        writable: true,
        onPath: true,
        ownedByPackage: false,
        recommended: true
      }).success
    ).toBe(true)
    expect(InstallTargetSuggestionSchema.safeParse({ path: '/x', writable: true }).success).toBe(
      false
    )
    expect(
      GetInstallTargetsResultSchema.safeParse({ candidates: [], defaultPath: null }).success
    ).toBe(true)
    expect(GetInstallTargetsResultSchema.safeParse({ candidates: [] }).success).toBe(false)
  })

  it('validates a GitHub repository search result', () => {
    const item = {
      full_name: 'pacstall/pacstall',
      description: 'A package manager',
      stargazers_count: 42,
      language: 'Shell',
      license: { spdx_id: 'GPL-3.0', name: 'GNU General Public License v3.0' },
      default_branch: 'master',
      html_url: 'https://github.com/pacstall/pacstall',
      updated_at: '2026-01-01T00:00:00Z'
    }
    expect(
      GitHubRepoSearchResultSchema.safeParse({
        total_count: 1,
        incomplete_results: false,
        items: [item]
      }).success
    ).toBe(true)
    expect(
      GitHubRepoSearchResultSchema.safeParse({
        total_count: 1,
        incomplete_results: false,
        items: [{ ...item, license: null }]
      }).success
    ).toBe(true)
    expect(
      GitHubRepoSearchResultSchema.safeParse({
        total_count: 1,
        incomplete_results: false,
        items: [{ ...item, stargazers_count: 'many' }]
      }).success
    ).toBe(false)
  })
})
