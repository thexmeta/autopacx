// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { parseDateOrNull, requireDate } from '../internal/date'
import { optionalBoolean, optionalNumber, optionalString } from '../internal/json'
import { isNewerVersion, normalizeVersion } from '../version'

const SENTINEL = Symbol('TrackedDebPackage.unset')
type Unset = typeof SENTINEL

export interface TrackedDebPackageInit {
  id?: number | null
  name: string
  packageUrl: string
  displayName?: string | null
  installedVersion?: string | null
  latestVersion?: string | null
  fileSize?: string | null
  fileDate?: Date | null
  lastChecked?: Date | null
  createdAt: Date
  checksum?: string | null
  autoUpdate?: boolean
  packageName?: string | null
  launchCommand?: string | null
}

/**
 * Represents a tracked Debian package from a direct URL.
 *
 * Used for tracking packages that are not from GitHub releases. Ported 1:1 from
 * `lib/models/tracked_deb_package.dart`.
 */
export class TrackedDebPackage {
  readonly id: number | null
  readonly name: string
  readonly packageUrl: string
  readonly displayName: string | null
  readonly installedVersion: string | null
  readonly latestVersion: string | null
  readonly fileSize: string | null
  readonly fileDate: Date | null
  readonly lastChecked: Date | null
  readonly createdAt: Date
  readonly checksum: string | null
  readonly autoUpdate: boolean
  readonly packageName: string | null
  readonly launchCommand: string | null

  constructor(init: TrackedDebPackageInit) {
    this.id = init.id ?? null
    this.name = init.name
    this.packageUrl = init.packageUrl
    this.displayName = init.displayName ?? null
    this.installedVersion = init.installedVersion ?? null
    this.latestVersion = init.latestVersion ?? null
    this.fileSize = init.fileSize ?? null
    this.fileDate = init.fileDate ?? null
    this.lastChecked = init.lastChecked ?? null
    this.createdAt = init.createdAt
    this.checksum = init.checksum ?? null
    this.autoUpdate = init.autoUpdate ?? false
    this.packageName = init.packageName ?? null
    this.launchCommand = init.launchCommand ?? null
  }

  /** Extract version from filename (e.g., "app_1.2.3_amd64.deb" -> "1.2.3"). */
  static extractVersionFromFilename(filename: string): string | null {
    const match = /[_-]([0-9]+(?:\.[0-9]+)*(?:-[a-zA-Z0-9]+)?)/.exec(filename)
    return match?.[1] ?? null
  }

  /** Get filename from URL. */
  get filename(): string {
    try {
      const url = new URL(this.packageUrl)
      const segments = url.pathname.split('/')
      return segments[segments.length - 1] ?? ''
    } catch {
      return ''
    }
  }

  /** Check if package has update available. */
  get hasUpdate(): boolean {
    if (this.installedVersion == null || this.latestVersion == null) return false
    const installed = normalizeVersion(this.installedVersion)
    const latest = normalizeVersion(this.latestVersion)
    if (installed === latest) return false
    return isNewerVersion(latest, installed)
  }

  /** Get display name or fallback to name. */
  get effectiveDisplayName(): string {
    return this.displayName ?? this.name
  }

  toMap(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      package_url: this.packageUrl,
      display_name: this.displayName,
      installed_version: this.installedVersion,
      latest_version: this.latestVersion,
      file_size: this.fileSize,
      file_date: this.fileDate?.toISOString() ?? null,
      last_checked: this.lastChecked?.toISOString() ?? null,
      created_at: this.createdAt.toISOString(),
      checksum: this.checksum,
      auto_update: this.autoUpdate,
      package_name: this.packageName,
      launch_command: this.launchCommand
    }
  }

  static fromMap(map: Record<string, unknown>): TrackedDebPackage {
    return new TrackedDebPackage({
      id: optionalNumber(map['id']),
      name: optionalString(map['name']) ?? '',
      packageUrl: optionalString(map['package_url']) ?? '',
      displayName: optionalString(map['display_name']),
      installedVersion: optionalString(map['installed_version']),
      latestVersion: optionalString(map['latest_version']),
      fileSize: optionalString(map['file_size']),
      fileDate: parseDateOrNull(map['file_date']),
      lastChecked: parseDateOrNull(map['last_checked']),
      createdAt: requireDate(map['created_at']),
      checksum: optionalString(map['checksum']),
      autoUpdate: optionalBoolean(map['auto_update']) ?? false,
      packageName: optionalString(map['package_name']),
      launchCommand: optionalString(map['launch_command'])
    })
  }

  copyWith(
    init: {
      id?: number | null | Unset
      name?: string
      packageUrl?: string
      displayName?: string | null | Unset
      installedVersion?: string | null | Unset
      latestVersion?: string | null | Unset
      fileSize?: string | null | Unset
      fileDate?: Date | null | Unset
      lastChecked?: Date | null | Unset
      createdAt?: Date
      checksum?: string | null | Unset
      autoUpdate?: boolean
      packageName?: string | null | Unset
      launchCommand?: string | null | Unset
    } = {}
  ): TrackedDebPackage {
    const {
      id = SENTINEL,
      name,
      packageUrl,
      displayName = SENTINEL,
      installedVersion = SENTINEL,
      latestVersion = SENTINEL,
      fileSize = SENTINEL,
      fileDate = SENTINEL,
      lastChecked = SENTINEL,
      createdAt,
      checksum = SENTINEL,
      autoUpdate,
      packageName = SENTINEL,
      launchCommand = SENTINEL
    } = init

    return new TrackedDebPackage({
      id: id === SENTINEL ? this.id : id,
      name: name ?? this.name,
      packageUrl: packageUrl ?? this.packageUrl,
      displayName: displayName === SENTINEL ? this.displayName : displayName,
      installedVersion: installedVersion === SENTINEL ? this.installedVersion : installedVersion,
      latestVersion: latestVersion === SENTINEL ? this.latestVersion : latestVersion,
      fileSize: fileSize === SENTINEL ? this.fileSize : fileSize,
      fileDate: fileDate === SENTINEL ? this.fileDate : fileDate,
      lastChecked: lastChecked === SENTINEL ? this.lastChecked : lastChecked,
      createdAt: createdAt ?? this.createdAt,
      checksum: checksum === SENTINEL ? this.checksum : checksum,
      autoUpdate: autoUpdate ?? this.autoUpdate,
      packageName: packageName === SENTINEL ? this.packageName : packageName,
      launchCommand: launchCommand === SENTINEL ? this.launchCommand : launchCommand
    })
  }
}
