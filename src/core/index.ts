// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Framework-free core of AutoPacX.
 *
 * This module is the shared kernel of the application. It MUST stay free of
 * Electron, Node.js and DOM imports so it can be consumed by the main process,
 * the preload bridge and the renderer alike.
 */

export const APP_NAME = 'autopacx'

/** Human-readable product name shown in window titles and the UI. */
export const APP_DISPLAY_NAME = 'AutoPacX'

export const APP_VERSION = '0.1.0'

// --- IPC contract -----------------------------------------------------------

export { IPC_CHANNEL_PREFIX, IPC_EVENT_CHANNEL, IPC_METHODS, DEFAULT_ARCH_TYPES } from './api'
export type {
  AddAppInput,
  AddDebPackageInput,
  AddPacstallPackageInput,
  AutopacxApi,
  BatchDeleteSummary,
  BatchOperationResultWire,
  BatchProgressEvent,
  BatchUpdateFailure,
  BatchUpdateResult,
  DebugLogResult,
  ExportResult,
  GetGithubReleaseAssetsInput,
  GetInstallTargetsInput,
  GitHubRepoSearchResultWire,
  GitHubRepoSearchSort,
  GitHubRepoSummaryWire,
  GithubAssetOptionWire,
  GithubReleaseAssetsWire,
  ImportResult,
  InstallOptions,
  InstallTargetSuggestionWire,
  InstallTargetsResultWire,
  IpcEvent,
  IpcMethod,
  MaskedSettings,
  OperationProgressEvent,
  PacstallBatchUpdateResult,
  PacstallIndexWire,
  PacstallPackageInfoWire,
  PacstallStatusWire,
  SearchGithubRepositoriesInput,
  Settings,
  TrackedAppWire,
  TrackedDebPackageWire,
  TrackedPacstallPackageWire
} from './api'

// --- Pure helpers -----------------------------------------------------------

export {
  matchesGlobPattern,
  isForeignOsAsset,
  matchesArchitecture,
  findMatchingArchitectures
} from './glob-pattern'

export { normalizeVersion, looksLikeVersion, isNewerVersion } from './version'

// --- Tracked-item ordering / filtering -------------------------------------

export { compareByName, applyFilter } from './tracked-order'
export type { NamedItem, ItemFilter, FilterPredicates } from './tracked-order'

// --- Models -----------------------------------------------------------------

export { InstallType, installTypeFromString, installTypeDisplayName } from './models/install-type'

export { Release, ReleaseAsset, parseReleases } from './models/release'
export type { ReleaseInit, ReleaseAssetInit } from './models/release'

export { TrackedApp } from './models/tracked-app'
export type { TrackedAppInit } from './models/tracked-app'

export { TrackedAppData, AppConfig } from './models/app-config'
export type { TrackedAppDataInit, AppConfigInit } from './models/app-config'

export { BatchOperationResult, BatchProgress } from './models/batch-operation-result'
export type { BatchOperationResultInit, BatchProgressInit } from './models/batch-operation-result'

export { TrackedDebPackage } from './models/tracked-deb-package'
export type { TrackedDebPackageInit } from './models/tracked-deb-package'

export { TrackedPacstallPackage } from './models/tracked-pacstall-package'
export type { TrackedPacstallPackageInit } from './models/tracked-pacstall-package'

// --- Pacstall ---------------------------------------------------------------

export { parseSrcInfo } from './pacstall/srcinfo'
export type { PacstallPackageInfo } from './pacstall/srcinfo'

export { filterPacstallIndex } from './pacstall/filter'

// --- GitHub repository search ----------------------------------------------

export { parseRepoSearch } from './github/repo-search'
export type { GitHubRepoLicense, GitHubRepoSummary, RepoSearchResult } from './github/repo-search'

// --- GitHub repository references ------------------------------------------

export { parseRepoReference, formatRepoReference } from './github/repo-reference'
export type { RepoReference } from './github/repo-reference'

// --- GitHub release-asset selection ----------------------------------------

export { groupAssetsByInstallType, choosePreferredAsset } from './github/asset-options'
export type { GithubAssetGroup, GithubAssetOption } from './github/asset-options'
