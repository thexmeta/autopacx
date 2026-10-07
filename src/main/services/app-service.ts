// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { AddAppInput, InstallOptions } from '@core/api'
import type { InstallType } from '@core/models/install-type'
import { TrackedApp } from '@core/models/tracked-app'
import type { ExternalCheckerLike, GitHubLike, InstallerLike } from './ports'
import type { TrackedRepository } from './tracked-repository'

export interface AppServiceDeps {
  readonly github: GitHubLike
  readonly installer: InstallerLike
  readonly external: ExternalCheckerLike
  readonly repo: TrackedRepository
}

/**
 * Orchestrates tracked-app installs, update checks and CRUD.
 *
 * Extracted from the IPC handlers so the transport layer only validates its
 * arguments and delegates; every business step (release lookup, download,
 * install, persist) lives here and is unit-testable without Electron.
 */
export class AppService {
  constructor(private readonly deps: AppServiceDeps) {}

  async install(app: TrackedApp, options: InstallOptions): Promise<TrackedApp> {
    const { github, installer, repo } = this.deps

    const assetName = options.assetName ?? null
    let packageName: string
    let downloadUrl: string
    let tagName: string
    let publishedAt: Date | null

    if (assetName != null && assetName.length > 0) {
      // An explicit choice bypasses the auto-pick: look the asset up by its
      // exact name in the latest release. No asset/architecture filters are
      // applied, because the user's pick is authoritative.
      const release = await github.getLatestRelease(app.repoOwner, app.repoName, {
        includePrerelease: app.includePrerelease
      })
      const asset = release?.assets.find((entry) => entry.name === assetName) ?? null
      if (release === null || asset === null) {
        throw new Error(
          `Selected package "${assetName}" is no longer available for ${app.displayName}`
        )
      }
      packageName = asset.name
      downloadUrl = asset.browserDownloadUrl
      tagName = release.tagName
      publishedAt = release.publishedAt
    } else {
      const info = await github.getLatestReleaseWithPackageInfo(app.repoOwner, app.repoName, {
        assetFilterPattern: app.assetFilterPattern,
        tagPrefix: app.tagPrefix,
        architectures: app.architectures,
        includePrerelease: app.includePrerelease
      })
      if (info === null || info.packageName === null || info.downloadUrl === null) {
        throw new Error(`No installable asset found for ${app.displayName}`)
      }
      packageName = info.packageName
      downloadUrl = info.downloadUrl
      tagName = info.release.tagName
      publishedAt = info.release.publishedAt
    }

    const type = installer.identifyAssetType(packageName, { app })
    if (type === null) {
      throw new Error(`No installable asset found for ${app.displayName}`)
    }

    const file = await installer.downloadFile(downloadUrl, packageName)
    const result = await installer.installPackage(file, type, {
      targetPath: options.targetPath ?? null,
      binaryName: options.binaryName ?? null
    })

    const updated = app.copyWith({
      installedVersion: tagName,
      installType: type,
      launchCommand: result.launchCommand,
      packageName: result.packageName,
      latestReleaseDate: publishedAt ?? app.latestReleaseDate,
      lastChecked: new Date()
    })
    await repo.updateApp(updated)
    return updated
  }

  async check(app: TrackedApp): Promise<TrackedApp> {
    const { github, external, repo } = this.deps
    const info = await github.getLatestReleaseWithPackageInfo(app.repoOwner, app.repoName, {
      assetFilterPattern: app.assetFilterPattern,
      tagPrefix: app.tagPrefix,
      architectures: app.architectures,
      includePrerelease: app.includePrerelease
    })
    const extVersion = await external.getExternalVersion(app)
    if (info === null && extVersion === null) return app

    const updated = app.copyWith({
      latestVersion: info?.release.tagName ?? app.latestVersion,
      installedVersion: extVersion ?? app.installedVersion,
      latestReleaseDate: info?.release.publishedAt ?? app.latestReleaseDate,
      fetchedPackage: info?.packageName ?? app.fetchedPackage,
      lastChecked: new Date()
    })
    await repo.updateApp(updated)
    return updated
  }

  /** Registers a new tracked app; throws when the repo is already tracked. */
  async add(input: AddAppInput): Promise<number> {
    const { repo } = this.deps
    const apps = await repo.listApps()
    if (apps.some((app) => app.repoOwner === input.repoOwner && app.repoName === input.repoName)) {
      throw new Error('App already exists')
    }
    const newApp = new TrackedApp({
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      displayName: input.displayName,
      createdAt: new Date(),
      assetFilterPattern: input.assetFilterPattern ?? null,
      tagPrefix: input.tagPrefix ?? null,
      architectures: input.architectures ?? [],
      includePrerelease: input.includePrerelease ?? false,
      launchCommand: input.launchCommand ?? null,
      packageName: input.packageName ?? null,
      installType: (input.installType ?? null) as InstallType | null
    })
    return repo.appendApp(newApp)
  }

  async update(app: TrackedApp): Promise<void> {
    await this.deps.repo.updateApp(app)
  }

  async remove(id: number): Promise<void> {
    await this.deps.repo.deleteApp(id)
  }
}
