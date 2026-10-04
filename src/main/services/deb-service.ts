// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { isNewerVersion, normalizeVersion } from '@core/index'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import type { AddDebPackageInput } from '@core/api'
import type { DatabaseLike, ExternalCheckerLike, InstallerLike } from './ports'
import type { TrackedRepository } from './tracked-repository'

export interface DebServiceDeps {
  readonly database: DatabaseLike
  readonly installer: InstallerLike
  readonly external: ExternalCheckerLike
  readonly repo: TrackedRepository
}

function lastSegment(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] ?? filePath
}

/**
 * Orchestrates tracked-deb-package installs, update checks and CRUD.
 *
 * The counterpart to {@link AppService} for direct-URL `.deb` packages.
 */
export class DebService {
  constructor(private readonly deps: DebServiceDeps) {}

  async install(pkg: TrackedDebPackage): Promise<TrackedDebPackage> {
    const { installer, repo } = this.deps
    const filename = pkg.name.endsWith('.deb') ? pkg.name : `${pkg.name}.deb`
    const file = await installer.downloadFile(pkg.packageUrl, filename)
    const result = await installer.installPackage(file, 'deb')
    const version = TrackedDebPackage.extractVersionFromFilename(lastSegment(file))

    const updated = pkg.copyWith({
      installedVersion: version ?? pkg.latestVersion,
      launchCommand: result.launchCommand,
      packageName: result.packageName,
      lastChecked: new Date()
    })
    await repo.updateDeb(updated)
    return updated
  }

  async check(pkg: TrackedDebPackage): Promise<string | null> {
    const { database, external, repo } = this.deps
    const info = await database.fetchDebInfo(pkg.packageUrl)
    const installedVersion = await external.getExternalDebVersion(pkg)

    if (info.version === null && installedVersion === null) return null

    await repo.updateDeb(
      pkg.copyWith({
        latestVersion: info.version ?? pkg.latestVersion,
        installedVersion: installedVersion ?? pkg.installedVersion,
        fileSize: info.fileSize ?? pkg.fileSize,
        fileDate: info.fileDate ?? pkg.fileDate,
        lastChecked: new Date()
      })
    )

    if (
      info.version !== null &&
      installedVersion !== null &&
      isNewerVersion(normalizeVersion(info.version), normalizeVersion(installedVersion))
    ) {
      return info.version
    }
    return null
  }

  /** Registers a new tracked package; throws when the URL is already tracked. */
  async add(input: AddDebPackageInput): Promise<number> {
    const { database, repo } = this.deps
    const packages = await repo.listDebs()
    if (packages.some((pkg) => pkg.packageUrl === input.packageUrl)) {
      throw new Error('Package URL already exists')
    }
    let pkg = new TrackedDebPackage({
      name: input.name,
      packageUrl: input.packageUrl,
      displayName: input.displayName ?? input.name,
      createdAt: new Date(),
      autoUpdate: input.autoUpdate ?? false,
      launchCommand: input.launchCommand ?? null,
      packageName: input.packageName ?? null
    })
    const info = await database.fetchDebInfo(input.packageUrl)
    pkg = pkg.copyWith({ fileSize: info.fileSize, fileDate: info.fileDate })
    return repo.appendDeb(pkg)
  }

  async update(pkg: TrackedDebPackage): Promise<void> {
    await this.deps.repo.updateDeb(pkg)
  }

  async remove(id: number): Promise<void> {
    await this.deps.repo.deleteDeb(id)
  }

  async launch(pkg: TrackedDebPackage): Promise<void> {
    await this.deps.installer.launchDebPackage(pkg)
  }
}
