// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Framework-free core of AutoNex.
 *
 * This module is the shared kernel of the application. It MUST stay free of
 * Electron, Node.js and DOM imports so it can be consumed by the main process,
 * the preload bridge and the renderer alike.
 */

export const APP_NAME = 'autonex'

/** Human-readable product name shown in window titles and the UI. */
export const APP_DISPLAY_NAME = 'AutoNex'

export const APP_VERSION = '0.1.0'

// --- IPC contract -----------------------------------------------------------

export { IPC_CHANNEL_PREFIX, IPC_EVENT_CHANNEL, IPC_METHODS } from './api'
export type {
  AddAppInput,
  AddDebPackageInput,
  AutonexApi,
  BatchDeleteSummary,
  BatchOperationResultWire,
  BatchProgressEvent,
  BatchUpdateResult,
  DebugLogResult,
  ExportResult,
  ImportResult,
  InstallOptions,
  IpcEvent,
  IpcMethod,
  MaskedSettings,
  Settings,
  TrackedAppWire,
  TrackedDebPackageWire
} from './api'

// --- Pure helpers -----------------------------------------------------------

export {
  matchesGlobPattern,
  isForeignOsAsset,
  matchesArchitecture,
  findMatchingArchitectures
} from './glob-pattern'

export { normalizeVersion, looksLikeVersion, isNewerVersion } from './version'

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
