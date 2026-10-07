// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { DebugLogResult, Settings } from '@core/api'
import type { RepoSearchResult } from '@core/github/repo-search'
import type { InstallType } from '@core/models/install-type'
import type { Release } from '@core/models/release'
import type { TrackedApp } from '@core/models/tracked-app'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import type { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import type { PacstallPackageInfo } from '@core/pacstall/srcinfo'
import type { DebRemoteInfo } from './database-service'
import type {
  GetLatestReleaseOptions,
  GithubReleaseAssets,
  ReleasePackageInfo,
  SearchRepositoriesOptions
} from './github-service'
import type { InstallTargetSuggestion } from './install-location'
import type { InstallPackageOptions, InstallResult } from './installer-service'
import type { PacstallIndexResult } from './pacstall-registry'
import type { PacstallStatus } from './pacstall-service'

/**
 * Narrow structural views of the concrete services, defined here so the
 * orchestration layer (services + IPC handlers) depends on the smallest
 * surface it actually uses. Tests substitute these with plain stubs.
 */

/** Narrow view of `GitHubService`. */
export interface GitHubLike {
  getLatestRelease(
    owner: string,
    repo: string,
    options?: GetLatestReleaseOptions
  ): Promise<Release | null>
  getLatestReleaseWithPackageInfo(
    owner: string,
    repo: string,
    options?: GetLatestReleaseOptions
  ): Promise<ReleasePackageInfo | null>
  getGithubReleaseAssets(
    owner: string,
    repo: string,
    options?: {
      readonly includePrerelease?: boolean
      readonly assetFilterPattern?: string
      readonly tagPrefix?: string
      readonly architectures?: readonly string[]
    }
  ): Promise<GithubReleaseAssets>
  searchRepositories(query: string, options?: SearchRepositoriesOptions): Promise<RepoSearchResult>
}

/** Narrow view of `PacstallService`. */
export interface PacstallLike {
  status(): Promise<PacstallStatus>
  install(name: string): Promise<void>
  remove(name: string): Promise<void>
  upgrade(name: string): Promise<void>
  upgradeAll(): Promise<void>
  checkUpdate(pkg: TrackedPacstallPackage): Promise<string | null>
  /** The version recorded in pacstall's metadata, or the literal `"unknown"`. */
  readInstalledVersion(name: string): Promise<string>
  /** Launches the package's launch command (or its name) detached. */
  launch(pkg: TrackedPacstallPackage): Promise<void>
}

/** Narrow view of `PacstallRegistry` used for index/metadata lookups. */
export interface PacstallRegistryPort {
  fetchIndex(options?: { readonly force?: boolean }): Promise<PacstallIndexResult>
  fetchPackageInfo(name: string): Promise<PacstallPackageInfo>
}

/** Narrow view of `InstallerService`. */
export interface InstallerLike {
  identifyAssetType(
    filename: string,
    options?: { readonly app?: TrackedApp | null }
  ): InstallType | null
  downloadFile(url: string, filename: string): Promise<string>
  installPackage(
    filePath: string,
    type: InstallType,
    options?: InstallPackageOptions
  ): Promise<InstallResult>
  uninstallPackage(app: TrackedApp): Promise<void>
  uninstallDebPackage(pkg: TrackedDebPackage): Promise<void>
  launchApp(app: TrackedApp): Promise<void>
  launchDebPackage(pkg: TrackedDebPackage): Promise<void>
}

/** Narrow view of `DatabaseService`. */
export interface DatabaseLike {
  fetchDebInfo(url: string): Promise<DebRemoteInfo>
}

/** Narrow view of `ExternalAppChecker`. */
export interface ExternalCheckerLike {
  getExternalVersion(app: TrackedApp): Promise<string | null>
  getExternalDebVersion(pkg: TrackedDebPackage): Promise<string | null>
}

/** The persistence surface the tracked-item repository needs. */
export interface TrackedStoreLike {
  readApps(): Promise<TrackedApp[]>
  writeApps(apps: readonly TrackedApp[]): Promise<void>
  readDebPackages(): Promise<TrackedDebPackage[]>
  writeDebPackages(packages: readonly TrackedDebPackage[]): Promise<void>
  readPacstallPackages(): Promise<TrackedPacstallPackage[]>
  writePacstallPackages(packages: readonly TrackedPacstallPackage[]): Promise<void>
}

/** Narrow view of `JsonStore`: tracked items plus settings. */
export interface StoreLike extends TrackedStoreLike {
  readSettings(): Promise<Settings>
  writeSettings(settings: Settings): Promise<void>
}

/** Narrow view of `TokenStore`. */
export interface TokenLike {
  hasToken(): Promise<boolean>
  setToken(token: string): Promise<void>
}

/** Narrow view of `ConfigService`. */
export interface ConfigLike {
  exportConfig(): Promise<string>
  importConfig(): Promise<number>
}

/** Narrow view of the debug logger used by the diagnostics handlers. */
export interface DebugLogLike {
  readTail(maxBytes?: number): Promise<DebugLogResult>
  clear(): Promise<void>
  setEnabled(value: boolean): void
}

/** Opens an external URL in the user's browser after validation. */
export interface ExternalLinkLike {
  open(url: string): Promise<void>
}

/** Narrow view of the install-target suggester (`install-location.ts`). */
export interface InstallLocationLike {
  suggestTargets(app: TrackedApp): Promise<InstallTargetSuggestion[]>
}
