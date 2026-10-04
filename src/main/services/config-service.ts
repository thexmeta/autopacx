// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppConfig, TrackedAppData } from '@core/models/app-config'
import type { TrackedApp } from '@core/models/tracked-app'
import type { JsonStore } from '../store/json-store'

/** Fixed filename the import action reads, mirroring the Dart settings sheet. */
export const IMPORT_FILE_NAME = 'autonex-import.json'

/** Highest id currently in use, or 0 when the list is empty. */
function maxId(apps: readonly TrackedApp[]): number {
  return apps.reduce((max, app) => Math.max(max, app.id ?? 0), 0)
}

/**
 * Config export/import, ported from `DatabaseService.exportConfig` /
 * `DatabaseService.importConfig`.
 *
 * Export writes `autonex-export-<date>.json` into the app data directory and
 * returns its path. Import reads the fixed `autonex-import.json` from the
 * same directory, adds any app whose `owner/name` pair is not already tracked,
 * and returns how many were added.
 */
export class ConfigService {
  private readonly store: JsonStore
  private readonly appVersion: string

  constructor(store: JsonStore, appVersion: string) {
    this.store = store
    this.appVersion = appVersion
  }

  async exportConfig(): Promise<string> {
    const apps = await this.store.readApps()
    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date(),
      appName: 'AutoNex',
      appVersion: this.appVersion,
      apps: apps.map(
        (app) =>
          new TrackedAppData({
            repoOwner: app.repoOwner,
            repoName: app.repoName,
            displayName: app.displayName,
            assetFilterPattern: app.assetFilterPattern,
            tagPrefix: app.tagPrefix,
            architectures: app.architectures,
            includePrerelease: app.includePrerelease,
            installedVersion: app.installedVersion,
            latestVersion: app.latestVersion,
            installType: app.installType,
            launchCommand: app.launchCommand,
            packageName: app.packageName,
            lastChecked: app.lastChecked,
            latestReleaseDate: app.latestReleaseDate,
            fetchedPackage: app.fetchedPackage
          })
      )
    })

    const date = new Date().toISOString().split('T')[0]
    const file = join(this.store.directory, `autonex-export-${date}.json`)
    await writeFile(file, JSON.stringify(config.toJson()), 'utf8')
    return file
  }

  async importConfig(): Promise<number> {
    const file = join(this.store.directory, IMPORT_FILE_NAME)
    if (!existsSync(file)) {
      throw new Error(`No import file found at ${file}`)
    }

    const content = await readFile(file, 'utf8')
    const config = AppConfig.fromJson(JSON.parse(content) as Record<string, unknown>)

    const apps = await this.store.readApps()
    let count = 0
    for (const data of config.apps) {
      const alreadyTracked = apps.some(
        (app) => app.repoOwner === data.repoOwner && app.repoName === data.repoName
      )
      if (alreadyTracked) continue
      apps.push(data.toTrackedApp(maxId(apps) + 1, { createdAt: new Date() }))
      count++
    }

    if (count > 0) await this.store.writeApps(apps)
    return count
  }
}
