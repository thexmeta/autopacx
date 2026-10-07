// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * The contract shared by the main process, the preload bridge and the
 * renderer.
 *
 * This module is part of the framework-free core: it must stay free of
 * Electron, Node.js and DOM imports. Everything here is either a type or a
 * plain constant so it can be consumed from any process.
 */

import type { GithubAssetOption } from './github/asset-options'
import type { GitHubRepoSummary, RepoSearchResult } from './github/repo-search'
import type { TrackedApp } from './models/tracked-app'
import type { TrackedDebPackage } from './models/tracked-deb-package'
import type { TrackedPacstallPackage } from './models/tracked-pacstall-package'
import type { PacstallPackageInfo } from './pacstall/srcinfo'

/**
 * Persisted application settings (`settings.json`).
 *
 * Keys mirror the Dart file verbatim, including `github_token`. Unknown keys
 * are preserved because the Dart service reads and writes an untyped map.
 *
 * This is the ON-DISK shape. It must never cross the IPC boundary: the
 * `getSettings` channel returns a {@link MaskedSettings} instead, so the
 * plaintext token (and its encrypted form) never reach the renderer.
 */
export interface Settings {
  readonly theme?: string
  readonly github_token?: string
  readonly github_releases_per_page?: number
  readonly default_architecture?: string
  /** Default architecture selection for a new app (multi-select). */
  readonly default_architectures?: string[]
  /** Default install format for a new app (an `InstallType` value); unset means "let the app decide". */
  readonly default_install_type?: string
  /**
   * Architecture types offered by the add-app picker. Ports the Dart dialog's
   * hardcoded `_availableArchitectures` list so the offered set is configurable.
   */
  readonly default_arch_type?: string[]
  /** Default asset-filter glob for a new app, e.g. `*.deb`. */
  readonly default_asset_filter_pattern?: string
  /**
   * Directory new raw-binary installs default to, e.g. `~/.local/bin`. The
   * install dialog composes `<dir>/<binaryName>` from it.
   */
  readonly default_binary_install_dir?: string
  readonly enable_debug_logging?: boolean
  readonly pacstall_enabled?: boolean
  readonly pacstall_registry_repo?: string
  readonly pacstall_registry_branch?: string
  readonly pacstall_index_ttl_hours?: number
  readonly pacstall_detected?: boolean
  readonly pacstall_version?: string | null
  readonly github_search_sort?: string
  readonly github_search_per_page?: number
  readonly [key: string]: unknown
}

/**
 * The renderer-facing settings: the persisted map with every token key
 * stripped, plus a boolean telling the UI whether a token is configured.
 */
export interface MaskedSettings {
  readonly theme?: string
  readonly github_releases_per_page?: number
  readonly default_architecture?: string
  /** Default architecture selection for a new app (multi-select). */
  readonly default_architectures?: string[]
  /** Default install format for a new app (an `InstallType` value); unset means "let the app decide". */
  readonly default_install_type?: string
  /**
   * Architecture types offered by the add-app picker. Ports the Dart dialog's
   * hardcoded `_availableArchitectures` list so the offered set is configurable.
   */
  readonly default_arch_type?: string[]
  /** Default asset-filter glob for a new app, e.g. `*.deb`. */
  readonly default_asset_filter_pattern?: string
  /**
   * Directory new raw-binary installs default to, e.g. `~/.local/bin`. The
   * install dialog composes `<dir>/<binaryName>` from it.
   */
  readonly default_binary_install_dir?: string
  readonly enable_debug_logging?: boolean
  readonly pacstall_enabled?: boolean
  readonly pacstall_registry_repo?: string
  readonly pacstall_registry_branch?: string
  readonly pacstall_index_ttl_hours?: number
  readonly pacstall_detected?: boolean
  readonly pacstall_version?: string | null
  readonly github_search_sort?: string
  readonly github_search_per_page?: number
  readonly hasGithubToken: boolean
  readonly [key: string]: unknown
}

/** Every channel is namespaced so a handler can never be mistaken for another. */
export const IPC_CHANNEL_PREFIX = 'autonex:'

/**
 * The architecture types the add-app picker offers by default. Ports the Dart
 * dialog's hardcoded `_availableArchitectures` list so the default set lives in
 * one place (the main-process defaults and the renderer both read it).
 */
export const DEFAULT_ARCH_TYPES = ['amd64', 'arm64', 'x86_64', 'arm', 'armhf', 'i386'] as const

/**
 * The single push channel used for long-running operation progress. The main
 * process emits {@link IpcEvent} values; the preload bridge forwards them to
 * the renderer through {@link AutonexApi.onEvent}.
 */
export const IPC_EVENT_CHANNEL = 'autonex:event'

/** Progress for a running batch operation. */
export interface BatchProgressEvent {
  readonly method: 'batchInstall' | 'batchDelete' | 'batchUpdate' | 'checkAllUpdates'
  readonly total: number
  readonly completed: number
  readonly successful: number
  readonly failed: number
  readonly currentOperation: string
}

/**
 * Progress for a single long-running install/uninstall/check operation.
 *
 * Unlike {@link BatchProgressEvent} this is discriminated by `kind`, so a
 * listener can tell the two apart when both travel on the same channel.
 */
export interface OperationProgressEvent {
  readonly kind: 'operation'
  readonly method:
    | 'installApp'
    | 'uninstallApp'
    | 'installDeb'
    | 'uninstallDebPackage'
    | 'upgradeApp'
    | 'checkAppUpdate'
    | 'checkDebUpdate'
  readonly phase:
    'starting' | 'downloading' | 'installing' | 'removing' | 'checking' | 'done' | 'failed'
  readonly name: string
  readonly completed: number
  readonly total: number
  readonly detail?: string
}

/** Discriminated union of every event pushed on {@link IPC_EVENT_CHANNEL}. */
export type IpcEvent = BatchProgressEvent | OperationProgressEvent

/**
 * The snake_case wire form of a {@link TrackedApp} as it crosses the IPC
 * boundary: the exact shape returned by `TrackedApp.toMap()`. Dates are
 * ISO-8601 strings and there are no getters, because Electron's structured
 * clone drops the class prototype. The renderer rebuilds the model with
 * `TrackedApp.fromMap`.
 */
export type TrackedAppWire = ReturnType<TrackedApp['toMap']>

/** The snake_case wire form of a {@link TrackedDebPackage} (`toMap()` output). */
export type TrackedDebPackageWire = ReturnType<TrackedDebPackage['toMap']>

/** The snake_case wire form of a `TrackedPacstallPackage` (`toMap()` output). */
export type TrackedPacstallPackageWire = ReturnType<TrackedPacstallPackage['toMap']>

/** A repository summary from a GitHub repository search (already snake_case). */
export type GitHubRepoSummaryWire = GitHubRepoSummary

/** The decoded `GET /search/repositories` response, as it crosses IPC. */
export type GitHubRepoSearchResultWire = RepoSearchResult

/**
 * One downloadable release asset offered as an install option. `installType` is
 * the main process's `identifyAssetType` verdict, so the renderer never has to
 * re-derive it from the filename.
 */
export type GithubAssetOptionWire = GithubAssetOption

/** The assets of the latest release, as they cross IPC. */
export interface GithubReleaseAssetsWire {
  /** The release's tag, or `null` when the repository has no usable release. */
  readonly tagName: string | null
  /** Installable assets only; unrecognised formats are omitted. */
  readonly assets: GithubAssetOptionWire[]
  /** ISO-8601 timestamp of the release, or `null` when it is unknown. */
  readonly publishedAt: string | null
  /**
   * Asset names that survived the requested filters, for a full-fidelity
   * preview. Absent when the caller did not ask for a preview.
   */
  readonly matchedNames?: string[]
  /** Total number of assets on the release, before filtering. */
  readonly totalAssets?: number
}

/** Input for {@link AutonexApi.getGithubReleaseAssets}. */
export interface GetGithubReleaseAssetsInput {
  readonly repoOwner: string
  readonly repoName: string
  readonly includePrerelease?: boolean
  /** Glob pattern an asset name must match to be listed. */
  readonly assetFilterPattern?: string
  /** Only consider releases whose tag starts with this prefix. */
  readonly tagPrefix?: string
  /** Only consider assets matching one of these architectures. */
  readonly architectures?: string[]
}

/** A parsed pacstall `.SRCINFO` document, as it crosses IPC. */
export type PacstallPackageInfoWire = PacstallPackageInfo

/** The renderer-facing pacstall installation status. */
export interface PacstallStatusWire {
  readonly installed: boolean
  readonly version: string | null
  readonly path: string | null
  readonly pathUnexpected: boolean
  /** Whether the user has enabled pacstall integration in settings. */
  readonly enabled: boolean
}

/** The pacstall package-name index with its cache provenance. */
export interface PacstallIndexWire {
  readonly names: string[]
  readonly fetchedAt: string
  readonly fromCache: boolean
}

/** Sort keys the repository-search UI may request; `best-match` is the default. */
export type GitHubRepoSearchSort = 'stars' | 'updated' | 'best-match'

/** Input for {@link AutonexApi.searchGithubRepositories}. */
export interface SearchGithubRepositoriesInput {
  readonly query: string
  readonly page?: number
  readonly perPage?: number
  readonly sort?: GitHubRepoSearchSort
}

/** Input for {@link AutonexApi.addPacstallPackage}. */
export interface AddPacstallPackageInput {
  readonly name: string
  readonly displayName?: string | null
  readonly autoUpdate?: boolean
  readonly launchCommand?: string | null
  readonly packageName?: string | null
}

/** Refreshed pacstall list after an all-pacstall update sweep. */
export interface PacstallBatchUpdateResult {
  readonly packages: TrackedPacstallPackageWire[]
  readonly failures: BatchUpdateFailure[]
}

/** Optional destination for a raw-binary install. */
export interface InstallOptions {
  readonly targetPath?: string | null
  readonly binaryName?: string | null
  /**
   * Exact name of the release asset to download. When absent the installer
   * auto-picks the best matching asset (see `getLatestReleaseWithPackageInfo`).
   */
  readonly assetName?: string | null
}

/** One candidate directory a raw-binary install could target. */
export interface InstallTargetSuggestionWire {
  readonly path: string
  /** Whether the current user can write into the directory. */
  readonly writable: boolean
  /** Whether the directory is already on the process `PATH`. */
  readonly onPath: boolean
  /** Whether the directory belongs to an installed system package. */
  readonly ownedByPackage: boolean
  /** Whether this is the top-ranked candidate the UI should pre-select. */
  readonly recommended: boolean
}

/** Input for {@link AutonexApi.getInstallTargets}. */
export interface GetInstallTargetsInput {
  /** The app / package name used to derive app-specific locations. */
  readonly name: string
  /** Expected install format (see {@link InstallType}); null when unspecified. */
  readonly installType?: string | null
}

/** Result of {@link AutonexApi.getInstallTargets}. */
export interface InstallTargetsResultWire {
  readonly candidates: InstallTargetSuggestionWire[]
  /** The recommended candidate's path, or `null` when none is writable. */
  readonly defaultPath: string | null
}

/** Input for {@link AutonexApi.addApp}, mirroring `DatabaseService.addApp`. */
export interface AddAppInput {
  readonly repoOwner: string
  readonly repoName: string
  readonly displayName: string
  readonly assetFilterPattern?: string | null
  readonly tagPrefix?: string | null
  readonly architectures?: string[]
  readonly includePrerelease?: boolean
  readonly launchCommand?: string | null
  readonly packageName?: string | null
  /** Expected install format (see {@link InstallType}); null when unspecified. */
  readonly installType?: string | null
}

/** Input for {@link AutonexApi.addDebPackage}. */
export interface AddDebPackageInput {
  readonly name: string
  readonly packageUrl: string
  readonly displayName?: string | null
  readonly autoUpdate?: boolean
  readonly launchCommand?: string | null
  readonly packageName?: string | null
}

/** Result of a single batch item. */
export interface BatchOperationResultWire {
  readonly appName: string
  readonly success: boolean
  readonly error: string | null
  readonly newVersion: string | null
}

/** A single item that failed during an all-packages update sweep. */
export interface BatchUpdateFailure {
  /** Display name of the app or package that could not be checked. */
  readonly name: string
  readonly error: string
}

/** Refreshed lists after an all-packages update sweep. */
export interface BatchUpdateResult {
  readonly apps: TrackedAppWire[]
  readonly debPackages: TrackedDebPackageWire[]
  readonly pacstallPackages: TrackedPacstallPackageWire[]
  /**
   * Per-item failures collected during the sweep. The sweep never aborts on a
   * single unreachable repository/host, so the renderer can report "N of M
   * failed" while still showing the refreshed lists.
   */
  readonly failures: BatchUpdateFailure[]
}

/** Tally returned by {@link AutonexApi.batchDelete}. */
export interface BatchDeleteSummary {
  readonly succeeded: number
  readonly failed: number
}

/** Result of {@link AutonexApi.exportData}. */
export interface ExportResult {
  readonly path: string
}

/** Result of {@link AutonexApi.importData}. */
export interface ImportResult {
  readonly count: number
}

/**
 * A tail of the debug log. `truncated` is true when only the most recent
 * portion of an oversized log is returned (mirrors the Dart viewer's 200 KB
 * tail read).
 */
export interface DebugLogResult {
  readonly content: string
  readonly truncated: boolean
}

/**
 * The renderer-facing bridge.
 *
 * Read methods (`getApps`/`getDebPackages`/`getSettings`/`getVersion`) resolve
 * to plain wire maps (not class instances) so the renderer can rehydrate them
 * and recover the prototype getters. Write methods mirror the Dart app's
 * operations and are all gated by the `trusted(event)` sender check in the
 * main process.
 */
export interface AutonexApi {
  readonly version: string
  getApps(): Promise<TrackedAppWire[]>
  getDebPackages(): Promise<TrackedDebPackageWire[]>
  getSettings(): Promise<MaskedSettings>
  getVersion(): Promise<string>
  /**
   * Reads the system clipboard's plain text via the main process. The renderer
   * cannot use `navigator.clipboard` because the session denies the
   * `clipboard-read` permission (see `src/main/security.ts`).
   */
  readClipboardText(): Promise<string>

  // --- GitHub token (encrypted at rest) --------------------------------------
  hasGithubToken(): Promise<boolean>
  setGithubToken(token: string): Promise<void>

  /**
   * Opens an allowlisted `https://` URL in the user's default browser. The
   * main process rejects any other scheme or host, so a renderer cannot turn
   * this into a generic URL/file opener.
   */
  openExternal(url: string): Promise<void>

  // --- Install / uninstall ---------------------------------------------------
  installApp(app: TrackedAppWire, options?: InstallOptions): Promise<TrackedAppWire>
  installDeb(pkg: TrackedDebPackageWire): Promise<TrackedDebPackageWire>
  uninstallApp(app: TrackedAppWire): Promise<void>
  uninstallDebPackage(pkg: TrackedDebPackageWire): Promise<void>
  /** Suggests directories a raw-binary install could target, best first. */
  getInstallTargets(input: GetInstallTargetsInput): Promise<InstallTargetsResultWire>

  // --- Updates ---------------------------------------------------------------
  checkAppUpdate(app: TrackedAppWire): Promise<TrackedAppWire>
  checkDebUpdate(pkg: TrackedDebPackageWire): Promise<string | null>
  checkAllUpdates(): Promise<BatchUpdateResult>

  // --- Launch ----------------------------------------------------------------
  launchApp(app: TrackedAppWire): Promise<void>
  launchDeb(pkg: TrackedDebPackageWire): Promise<void>

  // --- Tracked-app CRUD ------------------------------------------------------
  addApp(input: AddAppInput): Promise<number>
  updateApp(app: TrackedAppWire): Promise<void>
  deleteApp(id: number): Promise<void>

  // --- Tracked-deb CRUD ------------------------------------------------------
  addDebPackage(input: AddDebPackageInput): Promise<number>
  updateDebPackage(pkg: TrackedDebPackageWire): Promise<void>
  deleteDebPackage(id: number): Promise<void>

  // --- GitHub repository search ---------------------------------------------
  /** Searches GitHub repositories (used by the "add app" flow). */
  searchGithubRepositories(
    input: SearchGithubRepositoriesInput
  ): Promise<GitHubRepoSearchResultWire>
  /** Lists the latest release's installable assets for the package picker. */
  getGithubReleaseAssets(input: GetGithubReleaseAssetsInput): Promise<GithubReleaseAssetsWire>

  // --- Pacstall -------------------------------------------------------------
  /** pacstall installation status, plus whether the integration is enabled. */
  getPacstallStatus(): Promise<PacstallStatusWire>
  /** The registry package-name index (cached on disk). */
  getPacstallIndex(options?: { force?: boolean }): Promise<PacstallIndexWire>
  /** A single package's parsed `.SRCINFO` metadata. */
  getPacstallPackageInfo(input: { name: string }): Promise<PacstallPackageInfoWire>
  /** Every tracked pacstall package. */
  getPacstallPackages(): Promise<TrackedPacstallPackageWire[]>
  addPacstallPackage(input: AddPacstallPackageInput): Promise<number>
  installPacstallPackage(pkg: TrackedPacstallPackageWire): Promise<TrackedPacstallPackageWire>
  uninstallPacstallPackage(pkg: TrackedPacstallPackageWire): Promise<void>
  checkPacstallUpdate(pkg: TrackedPacstallPackageWire): Promise<string | null>
  updatePacstallPackage(pkg: TrackedPacstallPackageWire): Promise<void>
  deletePacstallPackage(id: number): Promise<void>
  launchPacstall(pkg: TrackedPacstallPackageWire): Promise<void>
  /** Sweeps every tracked pacstall package, never aborting on one failure. */
  checkPacstallAllUpdates(): Promise<PacstallBatchUpdateResult>

  // --- Data ------------------------------------------------------------------
  exportData(): Promise<ExportResult>
  importData(): Promise<ImportResult>

  // --- Diagnostics -----------------------------------------------------------
  /** Reads the most recent portion of the debug log. */
  getDebugLog(): Promise<DebugLogResult>
  /** Empties the debug log. */
  clearDebugLog(): Promise<void>

  // --- Settings --------------------------------------------------------------
  setSettings(settings: Settings): Promise<void>

  // --- Batch -----------------------------------------------------------------
  batchInstall(
    apps: TrackedAppWire[],
    debPackages: TrackedDebPackageWire[],
    pacstallPackages: TrackedPacstallPackageWire[]
  ): Promise<BatchOperationResultWire[]>
  batchDelete(
    appIds: number[],
    debPackageIds: number[],
    pacstallPackageIds: number[]
  ): Promise<BatchDeleteSummary>
  batchUpdate(
    apps: TrackedAppWire[],
    debPackages: TrackedDebPackageWire[],
    pacstallPackages: TrackedPacstallPackageWire[]
  ): Promise<BatchOperationResultWire[]>

  /** Subscribes to {@link IPC_EVENT_CHANNEL}; returns an unsubscribe function. */
  onEvent(listener: (event: IpcEvent) => void): () => void
}

/**
 * The allowlist of callable IPC methods.
 *
 * Adding a name here without a matching handler fails typecheck (the handler
 * map in `src/main/ipc-handlers.ts` is a total record over `IpcMethod`), and
 * adding a method to `AutonexApi` without implementing it fails typecheck
 * in the preload bridge.
 */
export const IPC_METHODS = [
  'getApps',
  'getDebPackages',
  'getSettings',
  'getVersion',
  'readClipboardText',
  'hasGithubToken',
  'setGithubToken',
  'openExternal',
  'installApp',
  'installDeb',
  'uninstallApp',
  'uninstallDebPackage',
  'getInstallTargets',
  'checkAppUpdate',
  'checkDebUpdate',
  'checkAllUpdates',
  'launchApp',
  'launchDeb',
  'addApp',
  'updateApp',
  'deleteApp',
  'addDebPackage',
  'updateDebPackage',
  'deleteDebPackage',
  'searchGithubRepositories',
  'getGithubReleaseAssets',
  'getPacstallStatus',
  'getPacstallIndex',
  'getPacstallPackageInfo',
  'getPacstallPackages',
  'addPacstallPackage',
  'installPacstallPackage',
  'uninstallPacstallPackage',
  'checkPacstallUpdate',
  'updatePacstallPackage',
  'deletePacstallPackage',
  'launchPacstall',
  'checkPacstallAllUpdates',
  'exportData',
  'importData',
  'getDebugLog',
  'clearDebugLog',
  'setSettings',
  'batchInstall',
  'batchDelete',
  'batchUpdate'
] as const

export type IpcMethod = (typeof IPC_METHODS)[number]
