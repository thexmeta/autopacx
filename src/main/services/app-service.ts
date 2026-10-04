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
    const info = await github.getLatestReleaseWithPackageInfo(app.repoOwner, app.repoName, {
      assetFilterPattern: app.assetFilterPattern,
      tagPrefix: app.tagPrefix,
      architectures: app.architectures,
      includePrerelease: app.includePrerelease
    })
    if (info === null || info.packageName === null || info.downloadUrl === null) {
      throw new Error(`No installable asset found for ${app.displayName}`)
    }

    const type = installer.identifyAssetType(info.packageName, { app })
    if (type === null) {
      throw new Error(`No installable asset found for ${app.displayName}`)
    }

    const file = await installer.downloadFile(info.downloadUrl, info.packageName)
    const result = await installer.installPackage(file, type, {
      targetPath: options.targetPath ?? null,
      binaryName: options.binaryName ?? null
    })

    const updated = app.copyWith({
      installedVersion: info.release.tagName,
      installType: type,
      launchCommand: result.launchCommand,
      packageName: result.packageName,
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
