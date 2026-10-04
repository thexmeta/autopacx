// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  APP_VERSION,
  IPC_CHANNEL_PREFIX,
  IPC_EVENT_CHANNEL,
  type AutonexApi,
  type IpcEvent,
  type IpcMethod
} from '@core/index'
import type {
  AddAppInput,
  AddDebPackageInput,
  BatchDeleteSummary,
  BatchOperationResultWire,
  BatchUpdateResult,
  DebugLogResult,
  ExportResult,
  ImportResult,
  InstallOptions,
  MaskedSettings,
  Settings,
  TrackedAppWire,
  TrackedDebPackageWire
} from '@core/index'

/**
 * The only path from the renderer to the main process: a typed `invoke` for an
 * allowlisted method. The raw `ipcRenderer` is never exposed, and neither is
 * `require`/`fs`, so the renderer cannot reach any channel we did not register.
 */
function invoke<T>(method: IpcMethod, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(`${IPC_CHANNEL_PREFIX}${method}`, ...args) as Promise<T>
}

const api: AutonexApi = {
  version: APP_VERSION,

  // --- Reads -----------------------------------------------------------------
  getApps: () => invoke<TrackedAppWire[]>('getApps'),
  getDebPackages: () => invoke<TrackedDebPackageWire[]>('getDebPackages'),
  getSettings: () => invoke<MaskedSettings>('getSettings'),
  getVersion: () => invoke<string>('getVersion'),

  // --- GitHub token ----------------------------------------------------------
  hasGithubToken: () => invoke<boolean>('hasGithubToken'),
  setGithubToken: (token: string) => invoke<void>('setGithubToken', token),

  // --- External links --------------------------------------------------------
  openExternal: (url: string) => invoke<void>('openExternal', url),

  // --- Install / uninstall ---------------------------------------------------
  installApp: (app: TrackedAppWire, options?: InstallOptions) =>
    invoke<TrackedAppWire>('installApp', app, options),
  installDeb: (pkg: TrackedDebPackageWire) => invoke<TrackedDebPackageWire>('installDeb', pkg),
  uninstallApp: (app: TrackedAppWire) => invoke<void>('uninstallApp', app),
  uninstallDebPackage: (pkg: TrackedDebPackageWire) => invoke<void>('uninstallDebPackage', pkg),

  // --- Updates ---------------------------------------------------------------
  checkAppUpdate: (app: TrackedAppWire) => invoke<TrackedAppWire>('checkAppUpdate', app),
  checkDebUpdate: (pkg: TrackedDebPackageWire) => invoke<string | null>('checkDebUpdate', pkg),
  checkAllUpdates: () => invoke<BatchUpdateResult>('checkAllUpdates'),

  // --- Launch ----------------------------------------------------------------
  launchApp: (app: TrackedAppWire) => invoke<void>('launchApp', app),
  launchDeb: (pkg: TrackedDebPackageWire) => invoke<void>('launchDeb', pkg),

  // --- Tracked-app CRUD ------------------------------------------------------
  addApp: (input: AddAppInput) => invoke<number>('addApp', input),
  updateApp: (app: TrackedAppWire) => invoke<void>('updateApp', app),
  deleteApp: (id: number) => invoke<void>('deleteApp', id),

  // --- Tracked-deb CRUD ------------------------------------------------------
  addDebPackage: (input: AddDebPackageInput) => invoke<number>('addDebPackage', input),
  updateDebPackage: (pkg: TrackedDebPackageWire) => invoke<void>('updateDebPackage', pkg),
  deleteDebPackage: (id: number) => invoke<void>('deleteDebPackage', id),

  // --- Data ------------------------------------------------------------------
  exportData: () => invoke<ExportResult>('exportData'),
  importData: () => invoke<ImportResult>('importData'),

  // --- Diagnostics -----------------------------------------------------------
  getDebugLog: () => invoke<DebugLogResult>('getDebugLog'),
  clearDebugLog: () => invoke<void>('clearDebugLog'),

  // --- Settings --------------------------------------------------------------
  setSettings: (settings: Settings) => invoke<void>('setSettings', settings),

  // --- Batch -----------------------------------------------------------------
  batchInstall: (apps: TrackedAppWire[], debPackages: TrackedDebPackageWire[]) =>
    invoke<BatchOperationResultWire[]>('batchInstall', apps, debPackages),
  batchDelete: (appIds: number[], debPackageIds: number[]) =>
    invoke<BatchDeleteSummary>('batchDelete', appIds, debPackageIds),
  batchUpdate: (apps: TrackedAppWire[], debPackages: TrackedDebPackageWire[]) =>
    invoke<BatchOperationResultWire[]>('batchUpdate', apps, debPackages),

  // --- Events ----------------------------------------------------------------
  onEvent: (listener: (event: IpcEvent) => void) => {
    const handler = (_event: IpcRendererEvent, value: IpcEvent): void => listener(value)
    ipcRenderer.on(IPC_EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler)
    }
  }
}

contextBridge.exposeInMainWorld('autonex', api)
