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

import type { TrackedApp } from './models/tracked-app'
import type { TrackedDebPackage } from './models/tracked-deb-package'

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
  readonly enable_debug_logging?: boolean
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
  readonly enable_debug_logging?: boolean
  readonly hasGithubToken: boolean
  readonly [key: string]: unknown
}

/** Every channel is namespaced so a handler can never be mistaken for another. */
export const IPC_CHANNEL_PREFIX = 'autonex:'

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

/** Discriminated union of every event pushed on {@link IPC_EVENT_CHANNEL}. */
export type IpcEvent = BatchProgressEvent

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

/** Optional destination for a raw-binary install. */
export interface InstallOptions {
  readonly targetPath?: string | null
  readonly binaryName?: string | null
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
    debPackages: TrackedDebPackageWire[]
  ): Promise<BatchOperationResultWire[]>
  batchDelete(appIds: number[], debPackageIds: number[]): Promise<BatchDeleteSummary>
  batchUpdate(
    apps: TrackedAppWire[],
    debPackages: TrackedDebPackageWire[]
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
  'hasGithubToken',
  'setGithubToken',
  'openExternal',
  'installApp',
  'installDeb',
  'uninstallApp',
  'uninstallDebPackage',
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
