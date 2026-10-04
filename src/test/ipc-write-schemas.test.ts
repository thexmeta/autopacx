// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import {
  AddAppArgsSchema,
  AddDebPackageArgsSchema,
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
  IdArgSchema,
  IdResultSchema,
  IdsArgSchema,
  ImportResultSchema,
  InstallOptionsSchema,
  MaskedSettingsSchema,
  NullableVersionSchema,
  OpenExternalArgsSchema,
  SetGithubTokenArgsSchema,
  SetSettingsArgsSchema,
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
    expect(InstallOptionsSchema.safeParse({ targetPath: 1 }).success).toBe(false)
  })
})

describe('request schemas — id arguments', () => {
  it('accepts an integer id and rejects non-integers', () => {
    expect(IdArgSchema.safeParse([3]).success).toBe(true)
    expect(IdArgSchema.safeParse([3.5]).success).toBe(false)
    expect(IdArgSchema.safeParse(['3']).success).toBe(false)
  })

  it('accepts two id lists', () => {
    expect(IdsArgSchema.safeParse([[1, 2], [3]]).success).toBe(true)
    expect(IdsArgSchema.safeParse([[1], ['x']]).success).toBe(false)
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
  it('accepts two lists of wire maps', () => {
    expect(BatchItemsArgsSchema.safeParse([[appMap], [debMap]]).success).toBe(true)
    expect(BatchItemsArgsSchema.safeParse([[appMap], 'nope']).success).toBe(false)
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
      BatchUpdateResultSchema.safeParse({ apps: [appMap], debPackages: [debMap], failures: [] })
        .success
    ).toBe(true)
    expect(
      BatchUpdateResultSchema.safeParse({
        apps: [],
        debPackages: [],
        failures: [{ name: 'Broken', error: 'offline' }]
      }).success
    ).toBe(true)
    // The failure list is part of the contract: a result without it is invalid.
    expect(
      BatchUpdateResultSchema.safeParse({ apps: [appMap], debPackages: [debMap] }).success
    ).toBe(false)
    expect(
      BatchUpdateResultSchema.safeParse({
        apps: [],
        debPackages: [],
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
