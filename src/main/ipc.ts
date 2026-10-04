// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC_CHANNEL_PREFIX, IPC_EVENT_CHANNEL, IPC_METHODS, type IpcMethod } from '@core/api'
import { createHandlers, type IpcDependencies } from './ipc-handlers'
import {
  BatchDeleteSummarySchema,
  BatchOperationResultSchema,
  BatchUpdateResultSchema,
  BooleanSchema,
  DebugLogResultSchema,
  ExportResultSchema,
  IdResultSchema,
  ImportResultSchema,
  MaskedSettingsSchema,
  NullableVersionSchema,
  TrackedAppSchema,
  TrackedDebPackageSchema,
  VersionSchema,
  VoidSchema
} from './ipc-schemas'
import { isTrustedFrame, originOf } from './trusted'

/** The dependencies a caller must supply; `emit` is bound to the window here. */
export type IpcRegistrationDeps = Omit<IpcDependencies, 'emit'>

/**
 * Result schemas, keyed by method.
 *
 * A total record over `IpcMethod`, so adding a channel without a result schema
 * fails typecheck alongside the handler map in `ipc-handlers.ts`.
 */
const resultSchemas: { readonly [K in IpcMethod]: z.ZodType } = {
  getApps: z.array(TrackedAppSchema),
  getDebPackages: z.array(TrackedDebPackageSchema),
  getSettings: MaskedSettingsSchema,
  getVersion: VersionSchema,
  hasGithubToken: BooleanSchema,
  setGithubToken: VoidSchema,
  openExternal: VoidSchema,
  installApp: TrackedAppSchema,
  installDeb: TrackedDebPackageSchema,
  uninstallApp: VoidSchema,
  uninstallDebPackage: VoidSchema,
  checkAppUpdate: TrackedAppSchema,
  checkDebUpdate: NullableVersionSchema,
  checkAllUpdates: BatchUpdateResultSchema,
  launchApp: VoidSchema,
  launchDeb: VoidSchema,
  addApp: IdResultSchema,
  updateApp: VoidSchema,
  deleteApp: VoidSchema,
  addDebPackage: IdResultSchema,
  updateDebPackage: VoidSchema,
  deleteDebPackage: VoidSchema,
  exportData: ExportResultSchema,
  importData: ImportResultSchema,
  getDebugLog: DebugLogResultSchema,
  clearDebugLog: VoidSchema,
  setSettings: VoidSchema,
  batchInstall: z.array(BatchOperationResultSchema),
  batchDelete: BatchDeleteSummarySchema,
  batchUpdate: z.array(BatchOperationResultSchema)
}

/**
 * Registers every IPC handler for [window].
 *
 * Each call is gated before it reaches a handler: the sender must be the main
 * window's webContents, on its main frame, from an allowlisted origin. Each
 * handler validates its own arguments against its Zod request schema and the
 * result is validated against the method's result schema before it crosses back
 * to the renderer. Long-running batch operations push typed progress events on
 * `autonex:event`.
 *
 * Registration is idempotent: each channel is removed before it is re-added, so
 * calling this once per window (the macOS `activate` path recreates the window)
 * neither throws "second handler" nor leaves a stale handler bound to a
 * destroyed webContents.
 */
export function registerIpcHandlers(window: BrowserWindow, deps: IpcRegistrationDeps): void {
  const expectedWebContentsId = window.webContents.id
  const allowedOrigins = allowedOriginsForRenderer()

  const handlers = createHandlers({
    ...deps,
    emit: (event) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_EVENT_CHANNEL, event)
      }
    }
  })

  for (const method of IPC_METHODS) {
    const channel = `${IPC_CHANNEL_PREFIX}${method}`

    // `ipcMain.handle` throws when a channel already has a handler; removing
    // first makes per-window registration safe and re-binds to the new window.
    ipcMain.removeHandler(channel)

    ipcMain.handle(channel, async (event, ...args) => {
      const trusted = isTrustedFrame({
        senderWebContentsId: event.sender.id,
        expectedWebContentsId,
        isMainFrame: event.senderFrame === event.sender.mainFrame,
        senderFrameUrl: event.senderFrame?.url ?? '',
        allowedOrigins
      })
      if (!trusted) {
        throw new Error(`Blocked IPC call to ${method} from an untrusted sender`)
      }

      const parsed = resultSchemas[method].safeParse(await handlers[method](args))
      if (!parsed.success) {
        throw new Error(`Invalid result for ${method}: ${parsed.error.message}`)
      }

      return parsed.data
    })
  }
}

/**
 * Origins the renderer may be served from: the packaged `file://` bundle, plus
 * the Vite dev server origin when running unpackaged.
 */
function allowedOriginsForRenderer(): string[] {
  const origins = ['file://']
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl !== undefined) {
    const devOrigin = originOf(devServerUrl)
    if (devOrigin !== null) origins.push(devOrigin)
  }
  return origins
}
