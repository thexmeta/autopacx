// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { parseDateOrNull, requireDate } from '../internal/date'
import { optionalBoolean, optionalNumber, optionalString } from '../internal/json'
import { isNewerVersion, normalizeVersion } from '../version'

const SENTINEL = Symbol('TrackedPacstallPackage.unset')
type Unset = typeof SENTINEL

export interface TrackedPacstallPackageInit {
  id?: number | null
  name: string
  displayName?: string | null
  description?: string | null
  maintainer?: string | null
  installedVersion?: string | null
  latestVersion?: string | null
  packageName?: string | null
  launchCommand?: string | null
  autoUpdate?: boolean
  lastChecked?: Date | null
  createdAt: Date
  registryRepo: string
}

/**
 * A pacstall package tracked from a registry repository.
 *
 * The pacstall counterpart of {@link TrackedDebPackage}: same wire discipline
 * (snake_case `toMap`/`fromMap`, `Date.toISOString()` for dates, which the
 * persistence layer rewrites to the Dart-local form) and the same shared
 * version comparator, because pacstall versions are semver-ish.
 */
export class TrackedPacstallPackage {
  readonly id: number | null
  readonly name: string
  readonly displayName: string | null
  readonly description: string | null
  readonly maintainer: string | null
  readonly installedVersion: string | null
  readonly latestVersion: string | null
  readonly packageName: string | null
  readonly launchCommand: string | null
  readonly autoUpdate: boolean
  readonly lastChecked: Date | null
  readonly createdAt: Date
  readonly registryRepo: string

  constructor(init: TrackedPacstallPackageInit) {
    this.id = init.id ?? null
    this.name = init.name
    this.displayName = init.displayName ?? null
    this.description = init.description ?? null
    this.maintainer = init.maintainer ?? null
    this.installedVersion = init.installedVersion ?? null
    this.latestVersion = init.latestVersion ?? null
    this.packageName = init.packageName ?? null
    this.launchCommand = init.launchCommand ?? null
    this.autoUpdate = init.autoUpdate ?? false
    this.lastChecked = init.lastChecked ?? null
    this.createdAt = init.createdAt
    this.registryRepo = init.registryRepo
  }

  /** Check if the package has an update available. */
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
      display_name: this.displayName,
      description: this.description,
      maintainer: this.maintainer,
      installed_version: this.installedVersion,
      latest_version: this.latestVersion,
      package_name: this.packageName,
      launch_command: this.launchCommand,
      auto_update: this.autoUpdate,
      last_checked: this.lastChecked?.toISOString() ?? null,
      created_at: this.createdAt.toISOString(),
      registry_repo: this.registryRepo
    }
  }

  static fromMap(map: Record<string, unknown>): TrackedPacstallPackage {
    return new TrackedPacstallPackage({
      id: optionalNumber(map['id']),
      name: optionalString(map['name']) ?? '',
      displayName: optionalString(map['display_name']),
      description: optionalString(map['description']),
      maintainer: optionalString(map['maintainer']),
      installedVersion: optionalString(map['installed_version']),
      latestVersion: optionalString(map['latest_version']),
      packageName: optionalString(map['package_name']),
      launchCommand: optionalString(map['launch_command']),
      autoUpdate: optionalBoolean(map['auto_update']) ?? false,
      lastChecked: parseDateOrNull(map['last_checked']),
      createdAt: requireDate(map['created_at']),
      registryRepo: optionalString(map['registry_repo']) ?? ''
    })
  }

  copyWith(
    init: {
      id?: number | null | Unset
      name?: string
      displayName?: string | null | Unset
      description?: string | null | Unset
      maintainer?: string | null | Unset
      installedVersion?: string | null | Unset
      latestVersion?: string | null | Unset
      packageName?: string | null | Unset
      launchCommand?: string | null | Unset
      autoUpdate?: boolean
      lastChecked?: Date | null | Unset
      createdAt?: Date
      registryRepo?: string
    } = {}
  ): TrackedPacstallPackage {
    const {
      id = SENTINEL,
      name,
      displayName = SENTINEL,
      description = SENTINEL,
      maintainer = SENTINEL,
      installedVersion = SENTINEL,
      latestVersion = SENTINEL,
      packageName = SENTINEL,
      launchCommand = SENTINEL,
      autoUpdate,
      lastChecked = SENTINEL,
      createdAt,
      registryRepo
    } = init

    return new TrackedPacstallPackage({
      id: id === SENTINEL ? this.id : id,
      name: name ?? this.name,
      displayName: displayName === SENTINEL ? this.displayName : displayName,
      description: description === SENTINEL ? this.description : description,
      maintainer: maintainer === SENTINEL ? this.maintainer : maintainer,
      installedVersion: installedVersion === SENTINEL ? this.installedVersion : installedVersion,
      latestVersion: latestVersion === SENTINEL ? this.latestVersion : latestVersion,
      packageName: packageName === SENTINEL ? this.packageName : packageName,
      launchCommand: launchCommand === SENTINEL ? this.launchCommand : launchCommand,
      autoUpdate: autoUpdate ?? this.autoUpdate,
      lastChecked: lastChecked === SENTINEL ? this.lastChecked : lastChecked,
      createdAt: createdAt ?? this.createdAt,
      registryRepo: registryRepo ?? this.registryRepo
    })
  }
}
