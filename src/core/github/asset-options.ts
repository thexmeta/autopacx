// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Pure helpers for the GitHub release-asset selection flow.
 *
 * Ported from `lib/ui/upgrade_flow.dart`: `groupAssetsByInstallType` mirrors
 * `pickInstallType` (which install formats are present) and
 * `choosePreferredAsset` mirrors `chooseAsset` (which asset to install when the
 * choice is unambiguous). Everything here is framework-free so it can be used
 * by the renderer dialog and unit tested without a browser.
 */

import { matchesArchitecture } from '../glob-pattern'
import { installTypeFromString, type InstallType } from '../models/install-type'

/** A single downloadable release asset offered as an install option. */
export interface GithubAssetOption {
  readonly name: string
  readonly size: number
  readonly downloadUrl: string
  /** A wire install type (see {@link InstallType}); empty when unrecognised. */
  readonly installType: string
}

/** The installable assets of one install format, in first-seen order. */
export interface GithubAssetGroup {
  readonly installType: InstallType
  readonly assets: GithubAssetOption[]
}

/**
 * Groups installable assets by their install type.
 *
 * Assets whose `installType` is not a recognised format are dropped: they are
 * not installable, so they are never offered as a choice.
 */
export function groupAssetsByInstallType(assets: readonly GithubAssetOption[]): GithubAssetGroup[] {
  const groups: GithubAssetGroup[] = []
  const byType = new Map<InstallType, GithubAssetGroup>()

  for (const asset of assets) {
    const type = installTypeFromString(asset.installType)
    if (type == null) continue

    let group = byType.get(type)
    if (group == null) {
      group = { installType: type, assets: [] }
      byType.set(type, group)
      groups.push(group)
    }
    group.assets.push(asset)
  }

  return groups
}

/**
 * Returns the asset to install when the choice is unambiguous, mirroring the
 * Dart `chooseAsset`: no candidates yields `null`, a single candidate is
 * returned silently, and a candidate matching one of `architectures` is
 * preferred. When several candidates remain the caller must ask the user.
 */
export function choosePreferredAsset(
  assets: readonly GithubAssetOption[],
  architectures: readonly string[]
): GithubAssetOption | null {
  if (assets.length === 0) return null
  if (assets.length === 1) return assets[0]

  if (architectures.length > 0) {
    const matches = assets.filter((asset) =>
      architectures.some((architecture) => matchesArchitecture(asset.name, architecture))
    )
    if (matches.length > 0) return matches[0]
  }

  return null
}
