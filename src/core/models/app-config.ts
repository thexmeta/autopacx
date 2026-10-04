// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { parseDateOrNull, requireDate } from '../internal/date'
import { optionalBoolean, optionalString, recordArray, stringArray } from '../internal/json'
import { installTypeFromString, type InstallType } from './install-type'
import { TrackedApp } from './tracked-app'

export interface TrackedAppDataInit {
  repoOwner: string
  repoName: string
  displayName: string
  assetFilterPattern?: string | null
  tagPrefix?: string | null
  architectures?: string[] | null
  includePrerelease?: boolean
  installedVersion?: string | null
  latestVersion?: string | null
  installType?: InstallType | null
  launchCommand?: string | null
  packageName?: string | null
  lastChecked?: Date | null
  latestReleaseDate?: Date | null
  fetchedPackage?: string | null
}

/**
 * A serialisable snapshot of a tracked app used by config export/import.
 *
 * Ported 1:1 from `lib/models/app_config.dart`. Note the wire format here is
 * camelCase (unlike `TrackedApp`, which is snake_case).
 */
export class TrackedAppData {
  readonly repoOwner: string
  readonly repoName: string
  readonly displayName: string
  readonly assetFilterPattern: string | null
  readonly tagPrefix: string | null
  readonly architectures: string[]
  readonly includePrerelease: boolean

  // Install state — carried through export/import so a round trip does not
  // silently drop what the user already installed.
  readonly installedVersion: string | null
  readonly latestVersion: string | null
  readonly installType: InstallType | null
  readonly launchCommand: string | null
  readonly packageName: string | null
  readonly lastChecked: Date | null
  readonly latestReleaseDate: Date | null
  readonly fetchedPackage: string | null

  constructor(init: TrackedAppDataInit) {
    this.repoOwner = init.repoOwner
    this.repoName = init.repoName
    this.displayName = init.displayName
    this.assetFilterPattern = init.assetFilterPattern ?? null
    this.tagPrefix = init.tagPrefix ?? null
    this.architectures = init.architectures ?? []
    this.includePrerelease = init.includePrerelease ?? false
    this.installedVersion = init.installedVersion ?? null
    this.latestVersion = init.latestVersion ?? null
    this.installType = init.installType ?? null
    this.launchCommand = init.launchCommand ?? null
    this.packageName = init.packageName ?? null
    this.lastChecked = init.lastChecked ?? null
    this.latestReleaseDate = init.latestReleaseDate ?? null
    this.fetchedPackage = init.fetchedPackage ?? null
  }

  toMap(): Record<string, unknown> {
    return {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      displayName: this.displayName,
      assetFilterPattern: this.assetFilterPattern,
      tagPrefix: this.tagPrefix,
      architectures: this.architectures,
      includePrerelease: this.includePrerelease,
      installedVersion: this.installedVersion,
      latestVersion: this.latestVersion,
      installType: this.installType,
      launchCommand: this.launchCommand,
      packageName: this.packageName,
      lastChecked: this.lastChecked?.toISOString() ?? null,
      latestReleaseDate: this.latestReleaseDate?.toISOString() ?? null,
      fetchedPackage: this.fetchedPackage
    }
  }

  static fromMap(map: Record<string, unknown>): TrackedAppData {
    return new TrackedAppData({
      repoOwner: optionalString(map['repoOwner']) ?? '',
      repoName: optionalString(map['repoName']) ?? '',
      displayName: optionalString(map['displayName']) ?? '',
      assetFilterPattern: optionalString(map['assetFilterPattern']),
      tagPrefix: optionalString(map['tagPrefix']),
      architectures: stringArray(map['architectures']) ?? [],
      includePrerelease: optionalBoolean(map['includePrerelease']) ?? false,
      installedVersion: optionalString(map['installedVersion']),
      latestVersion: optionalString(map['latestVersion']),
      installType: installTypeFromString(optionalString(map['installType'])),
      launchCommand: optionalString(map['launchCommand']),
      packageName: optionalString(map['packageName']),
      lastChecked: parseDateOrNull(map['lastChecked']),
      latestReleaseDate: parseDateOrNull(map['latestReleaseDate']),
      fetchedPackage: optionalString(map['fetchedPackage'])
    })
  }

  toTrackedApp(id: number, init: { createdAt?: Date } = {}): TrackedApp {
    return new TrackedApp({
      id,
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      displayName: this.displayName,
      assetFilterPattern: this.assetFilterPattern,
      tagPrefix: this.tagPrefix,
      architectures: this.architectures,
      includePrerelease: this.includePrerelease,
      installedVersion: this.installedVersion,
      latestVersion: this.latestVersion,
      installType: this.installType,
      launchCommand: this.launchCommand,
      packageName: this.packageName,
      lastChecked: this.lastChecked,
      latestReleaseDate: this.latestReleaseDate,
      fetchedPackage: this.fetchedPackage,
      createdAt: init.createdAt ?? new Date()
    })
  }
}

export interface AppConfigInit {
  schemaVersion: string
  exportedAt: Date
  appName?: string | null
  appVersion?: string | null
  apps: TrackedAppData[]
}

/** Top-level config export/import document. */
export class AppConfig {
  readonly schemaVersion: string
  readonly exportedAt: Date
  readonly appName: string | null
  readonly appVersion: string | null
  readonly apps: TrackedAppData[]

  constructor(init: AppConfigInit) {
    this.schemaVersion = init.schemaVersion
    this.exportedAt = init.exportedAt
    this.appName = init.appName ?? null
    this.appVersion = init.appVersion ?? null
    this.apps = init.apps
  }

  toJson(): Record<string, unknown> {
    return {
      schemaVersion: this.schemaVersion,
      exportedAt: this.exportedAt.toISOString(),
      appName: this.appName,
      appVersion: this.appVersion,
      apps: this.apps.map((app) => app.toMap())
    }
  }

  static fromJson(json: Record<string, unknown>): AppConfig {
    return new AppConfig({
      schemaVersion: optionalString(json['schemaVersion']) ?? '',
      exportedAt: requireDate(json['exportedAt']),
      appName: optionalString(json['appName']),
      appVersion: optionalString(json['appVersion']),
      apps: recordArray(json['apps']).map((app) => TrackedAppData.fromMap(app))
    })
  }
}
