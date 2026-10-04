// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { parseDateOrNull, requireDate } from '../internal/date'
import { optionalBoolean, optionalNumber, optionalString, stringArray } from '../internal/json'
import { installTypeFromString, type InstallType as InstallTypeValue } from './install-type'
import { isNewerVersion, looksLikeVersion, normalizeVersion } from '../version'

const SENTINEL = Symbol('TrackedApp.unset')
type Unset = typeof SENTINEL

export interface TrackedAppInit {
  id?: number | null
  repoOwner: string
  repoName: string
  displayName: string
  installedVersion?: string | null
  latestVersion?: string | null
  installType?: InstallTypeValue | null
  launchCommand?: string | null
  packageName?: string | null
  lastChecked?: Date | null
  createdAt: Date
  latestReleaseDate?: Date | null
  fetchedPackage?: string | null
  assetFilterPattern?: string | null
  tagPrefix?: string | null
  architectures?: string[] | null
  includePrerelease?: boolean
}

/**
 * A GitHub repository tracked for releases.
 *
 * Ported 1:1 from `lib/models/tracked_app.dart`. The wire format in
 * `toMap`/`fromMap` is snake_case and must not change.
 */
export class TrackedApp {
  readonly id: number | null
  readonly repoOwner: string
  readonly repoName: string
  readonly displayName: string
  readonly installedVersion: string | null
  readonly latestVersion: string | null
  readonly installType: InstallTypeValue | null
  readonly launchCommand: string | null
  readonly packageName: string | null
  readonly lastChecked: Date | null
  readonly createdAt: Date
  readonly latestReleaseDate: Date | null
  readonly fetchedPackage: string | null

  // Advanced filtering fields
  readonly assetFilterPattern: string | null
  readonly tagPrefix: string | null
  readonly architectures: string[]
  readonly includePrerelease: boolean

  constructor(init: TrackedAppInit) {
    this.id = init.id ?? null
    this.repoOwner = init.repoOwner
    this.repoName = init.repoName
    this.displayName = init.displayName
    this.installedVersion = init.installedVersion ?? null
    this.latestVersion = init.latestVersion ?? null
    this.installType = init.installType ?? null
    this.launchCommand = init.launchCommand ?? null
    this.packageName = init.packageName ?? null
    this.lastChecked = init.lastChecked ?? null
    this.createdAt = init.createdAt
    this.latestReleaseDate = init.latestReleaseDate ?? null
    this.fetchedPackage = init.fetchedPackage ?? null
    this.assetFilterPattern = init.assetFilterPattern ?? null
    this.tagPrefix = init.tagPrefix ?? null
    this.architectures = init.architectures ?? []
    this.includePrerelease = init.includePrerelease ?? false
  }

  get repoUrl(): string {
    return `https://github.com/${this.repoOwner}/${this.repoName}`
  }

  get hasUpdate(): boolean {
    if (this.installedVersion == null || this.latestVersion == null) return false
    const installed = normalizeVersion(this.installedVersion)
    const latest = normalizeVersion(this.latestVersion)
    // Shape-check the NORMALISED value. An npm specifier such as
    // `@biomejs/biome@2.5.15` carries a real version after its final `@`, so
    // testing the raw string hid a genuine update; a value that is still not
    // version-shaped after normalising (e.g. `multiplatform#1`) is rejected.
    if (!looksLikeVersion(latest)) return false
    if (installed === latest) return false
    return isNewerVersion(latest, installed)
  }

  get isInstalled(): boolean {
    return this.installedVersion != null
  }

  toMap(): Record<string, unknown> {
    return {
      id: this.id,
      repo_owner: this.repoOwner,
      repo_name: this.repoName,
      display_name: this.displayName,
      installed_version: this.installedVersion,
      latest_version: this.latestVersion,
      install_type: this.installType,
      launch_command: this.launchCommand,
      package_name: this.packageName,
      last_checked: this.lastChecked?.toISOString() ?? null,
      created_at: this.createdAt.toISOString(),
      latest_release_date: this.latestReleaseDate?.toISOString() ?? null,
      fetched_package: this.fetchedPackage,
      asset_filter_pattern: this.assetFilterPattern,
      tag_prefix: this.tagPrefix,
      architectures: this.architectures,
      include_prerelease: this.includePrerelease
    }
  }

  static fromMap(map: Record<string, unknown>): TrackedApp {
    // Values may arrive from JSON/SQLite as non-String types, so coerce
    // instead of casting.
    const installedVersion = optionalString(map['installed_version'])
    const latestVersion = optionalString(map['latest_version'])

    return new TrackedApp({
      id: optionalNumber(map['id']),
      repoOwner: optionalString(map['repo_owner']) ?? '',
      repoName: optionalString(map['repo_name']) ?? '',
      displayName: optionalString(map['display_name']) ?? '',
      installedVersion: nonBlank(installedVersion),
      latestVersion: nonBlank(latestVersion),
      installType: installTypeFromString(optionalString(map['install_type'])),
      launchCommand: optionalString(map['launch_command']),
      packageName: optionalString(map['package_name']),
      lastChecked: parseDateOrNull(map['last_checked']),
      createdAt: requireDate(map['created_at']),
      latestReleaseDate: parseDateOrNull(map['latest_release_date']),
      fetchedPackage: optionalString(map['fetched_package']),
      assetFilterPattern: optionalString(map['asset_filter_pattern']),
      tagPrefix: optionalString(map['tag_prefix']),
      architectures: stringArray(map['architectures']) ?? [],
      includePrerelease: optionalBoolean(map['include_prerelease']) ?? false
    })
  }

  copyWith(
    init: {
      id?: number | null | Unset
      repoOwner?: string
      repoName?: string
      displayName?: string
      installedVersion?: string | null | Unset
      latestVersion?: string | null | Unset
      installType?: InstallTypeValue | null | Unset
      launchCommand?: string | null | Unset
      packageName?: string | null | Unset
      lastChecked?: Date | null | Unset
      createdAt?: Date
      latestReleaseDate?: Date | null | Unset
      fetchedPackage?: string | null | Unset
      assetFilterPattern?: string | null | Unset
      tagPrefix?: string | null | Unset
      architectures?: string[]
      includePrerelease?: boolean
    } = {}
  ): TrackedApp {
    const {
      id = SENTINEL,
      repoOwner,
      repoName,
      displayName,
      installedVersion = SENTINEL,
      latestVersion = SENTINEL,
      installType = SENTINEL,
      launchCommand = SENTINEL,
      packageName = SENTINEL,
      lastChecked = SENTINEL,
      createdAt,
      latestReleaseDate = SENTINEL,
      fetchedPackage = SENTINEL,
      assetFilterPattern = SENTINEL,
      tagPrefix = SENTINEL,
      architectures,
      includePrerelease
    } = init

    return new TrackedApp({
      id: id === SENTINEL ? this.id : id,
      repoOwner: repoOwner ?? this.repoOwner,
      repoName: repoName ?? this.repoName,
      displayName: displayName ?? this.displayName,
      installedVersion: installedVersion === SENTINEL ? this.installedVersion : installedVersion,
      latestVersion: latestVersion === SENTINEL ? this.latestVersion : latestVersion,
      installType: installType === SENTINEL ? this.installType : installType,
      launchCommand: launchCommand === SENTINEL ? this.launchCommand : launchCommand,
      packageName: packageName === SENTINEL ? this.packageName : packageName,
      lastChecked: lastChecked === SENTINEL ? this.lastChecked : lastChecked,
      createdAt: createdAt ?? this.createdAt,
      latestReleaseDate:
        latestReleaseDate === SENTINEL ? this.latestReleaseDate : latestReleaseDate,
      fetchedPackage: fetchedPackage === SENTINEL ? this.fetchedPackage : fetchedPackage,
      assetFilterPattern:
        assetFilterPattern === SENTINEL ? this.assetFilterPattern : assetFilterPattern,
      tagPrefix: tagPrefix === SENTINEL ? this.tagPrefix : tagPrefix,
      architectures: architectures ?? this.architectures,
      includePrerelease: includePrerelease ?? this.includePrerelease
    })
  }

  /** Validates the asset filter pattern (glob pattern). */
  static isValidFilterPattern(pattern: string | null | undefined): boolean {
    if (pattern == null || pattern.length === 0) return true
    // Wildcards, extensions and plain literal filenames are all valid
    // glob patterns, so only whitespace-only input is rejected.
    return pattern.trim().length > 0
  }

  /** Validates the tag prefix. */
  static isValidTagPrefix(prefix: string | null | undefined): boolean {
    if (prefix == null || prefix.length === 0) return true
    // Tag prefix should not contain special characters
    return /^[a-zA-Z0-9_-]+$/.test(prefix)
  }

  /** Validates all filter settings. */
  static validateFilterSettings(
    init: {
      assetFilterPattern?: string | null
      tagPrefix?: string | null
      architectures?: string[] | null
    } = {}
  ): string | null {
    const { assetFilterPattern, tagPrefix } = init

    if (
      assetFilterPattern != null &&
      assetFilterPattern.length > 0 &&
      !TrackedApp.isValidFilterPattern(assetFilterPattern)
    ) {
      return 'Invalid asset filter pattern. Use wildcards like * or ?'
    }

    if (tagPrefix != null && !TrackedApp.isValidTagPrefix(tagPrefix)) {
      return 'Invalid tag prefix. Use only alphanumeric characters, hyphens, and underscores.'
    }

    return null
  }
}

/** Returns `null` for a null/blank string, otherwise the original value. */
function nonBlank(value: string | null): string | null {
  if (value == null) return null
  return value.trim().length === 0 ? null : value
}
