// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type {
  BatchDeleteSummary,
  BatchOperationResultWire,
  BatchProgressEvent,
  BatchUpdateFailure,
  BatchUpdateResult,
  DebugLogResult,
  ExportResult,
  ImportResult,
  IpcEvent,
  IpcMethod,
  MaskedSettings,
  Settings
} from '@core/api'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { AppService } from './services/app-service'
import { DebService } from './services/deb-service'
import { TrackedRepository } from './services/tracked-repository'
import type {
  ConfigLike,
  DatabaseLike,
  DebugLogLike,
  ExternalCheckerLike,
  ExternalLinkLike,
  GitHubLike,
  InstallerLike,
  StoreLike,
  TokenLike
} from './services/ports'
import {
  AddAppArgsSchema,
  AddDebPackageArgsSchema,
  AppArgSchema,
  AppArgWithOptionsSchema,
  BatchItemsArgsSchema,
  DebArgSchema,
  IdArgSchema,
  IdsArgSchema,
  NoArgs,
  OpenExternalArgsSchema,
  SetGithubTokenArgsSchema,
  SetSettingsArgsSchema
} from './ipc-schemas'

// The narrow service seams live in `services/ports.ts`; re-exported here so
// existing importers (and tests) keep a single, stable entry point.
export type {
  ConfigLike,
  DatabaseLike,
  DebugLogLike,
  ExternalCheckerLike,
  ExternalLinkLike,
  GitHubLike,
  InstallerLike,
  StoreLike,
  TokenLike
}

export interface IpcDependencies {
  readonly store: StoreLike
  readonly github: GitHubLike
  readonly installer: InstallerLike
  readonly database: DatabaseLike
  readonly external: ExternalCheckerLike
  readonly token: TokenLike
  readonly config: ConfigLike
  readonly debugLog: DebugLogLike
  /** Opens allowlisted external URLs in the user's browser. */
  readonly externalLink: ExternalLinkLike
  /** Running app version, used by `getVersion` and config export. */
  readonly appVersion: string
  /** Pushes a typed progress event to the renderer. */
  readonly emit: (event: IpcEvent) => void
}

export type IpcHandler = (args: readonly unknown[]) => Promise<unknown>

/** A total record: adding a method to `IPC_METHODS` without a handler fails typecheck. */
export type IpcHandlers = { readonly [K in IpcMethod]: IpcHandler }

// --- Helpers ----------------------------------------------------------------

/** The settings keys that must never be exposed or accepted over IPC. */
const TOKEN_KEYS = ['github_token', 'github_token_enc'] as const

/**
 * Returns the persisted settings with every token key stripped and the
 * `hasGithubToken` flag added, so the renderer never sees the token.
 */
export function maskSettings(settings: Settings, hasGithubToken: boolean): MaskedSettings {
  const masked: Record<string, unknown> = { ...settings }
  for (const key of TOKEN_KEYS) delete masked[key]
  delete masked['hasGithubToken']
  masked['hasGithubToken'] = hasGithubToken
  return masked as MaskedSettings
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Builds the handlers backing every IPC channel.
 *
 * Each handler validates its own arguments against its Zod request schema and
 * delegates the work to a service (`AppService`/`DebService`) or the store.
 * Kept free of Electron so the orchestration can be unit tested with stubbed
 * services; `src/main/ipc.ts` owns the sender check and the result validation.
 */
export function createHandlers(deps: IpcDependencies): IpcHandlers {
  const { store, installer, token, config, debugLog } = deps

  const repo = new TrackedRepository(store)
  const appService = new AppService({
    github: deps.github,
    installer: deps.installer,
    external: deps.external,
    repo
  })
  const debService = new DebService({
    database: deps.database,
    installer: deps.installer,
    external: deps.external,
    repo
  })

  const listApps = async (): Promise<Record<string, unknown>[]> =>
    (await repo.listApps()).map((app) => app.toMap())
  const listDebs = async (): Promise<Record<string, unknown>[]> =>
    (await repo.listDebs()).map((pkg) => pkg.toMap())

  return {
    getApps: async (args) => {
      NoArgs.parse(args)
      return listApps()
    },

    getDebPackages: async (args) => {
      NoArgs.parse(args)
      return listDebs()
    },

    getSettings: async (args) => {
      NoArgs.parse(args)
      const settings = await store.readSettings()
      return maskSettings(settings, await token.hasToken())
    },

    getVersion: async (args) => {
      NoArgs.parse(args)
      return deps.appVersion
    },

    hasGithubToken: async (args) => {
      NoArgs.parse(args)
      return token.hasToken()
    },

    setGithubToken: async (args) => {
      const [value] = SetGithubTokenArgsSchema.parse(args)
      await token.setToken(value)
      return undefined
    },

    openExternal: async (args) => {
      const [url] = OpenExternalArgsSchema.parse(args)
      await deps.externalLink.open(url)
      return undefined
    },

    installApp: async (args) => {
      const [map, options] = AppArgWithOptionsSchema.parse(args)
      const updated = await appService.install(TrackedApp.fromMap(map), options ?? {})
      return updated.toMap()
    },

    installDeb: async (args) => {
      const [map] = DebArgSchema.parse(args)
      const updated = await debService.install(TrackedDebPackage.fromMap(map))
      return updated.toMap()
    },

    uninstallApp: async (args) => {
      const [map] = AppArgSchema.parse(args)
      await installer.uninstallPackage(TrackedApp.fromMap(map))
      return undefined
    },

    uninstallDebPackage: async (args) => {
      const [map] = DebArgSchema.parse(args)
      await installer.uninstallDebPackage(TrackedDebPackage.fromMap(map))
      return undefined
    },

    checkAppUpdate: async (args) => {
      const [map] = AppArgSchema.parse(args)
      const updated = await appService.check(TrackedApp.fromMap(map))
      return updated.toMap()
    },

    checkDebUpdate: async (args) => {
      const [map] = DebArgSchema.parse(args)
      return debService.check(TrackedDebPackage.fromMap(map))
    },

    checkAllUpdates: async (args): Promise<BatchUpdateResult> => {
      NoArgs.parse(args)
      const apps = await repo.listApps()
      const debs = await repo.listDebs()
      const total = apps.length + debs.length
      const failures: BatchUpdateFailure[] = []
      let completed = 0
      let successful = 0
      let failed = 0
      const report = (currentOperation: string): void =>
        deps.emit({
          method: 'checkAllUpdates',
          total,
          completed,
          successful,
          failed,
          currentOperation
        })

      for (const app of apps) {
        report(app.displayName)
        try {
          await appService.check(app)
          successful++
        } catch (error) {
          failed++
          failures.push({ name: app.displayName, error: errorMessage(error) })
        }
        completed++
        report(app.displayName)
      }

      for (const pkg of debs) {
        report(pkg.effectiveDisplayName)
        try {
          await debService.check(pkg)
          successful++
        } catch (error) {
          failed++
          failures.push({ name: pkg.effectiveDisplayName, error: errorMessage(error) })
        }
        completed++
        report(pkg.effectiveDisplayName)
      }

      return { apps: await listApps(), debPackages: await listDebs(), failures }
    },

    launchApp: async (args) => {
      const [map] = AppArgSchema.parse(args)
      await installer.launchApp(TrackedApp.fromMap(map))
      return undefined
    },

    launchDeb: async (args) => {
      const [map] = DebArgSchema.parse(args)
      await debService.launch(TrackedDebPackage.fromMap(map))
      return undefined
    },

    addApp: async (args) => {
      const [input] = AddAppArgsSchema.parse(args)
      return appService.add(input)
    },

    updateApp: async (args) => {
      const [map] = AppArgSchema.parse(args)
      await appService.update(TrackedApp.fromMap(map))
      return undefined
    },

    deleteApp: async (args) => {
      const [id] = IdArgSchema.parse(args)
      await appService.remove(id)
      return undefined
    },

    addDebPackage: async (args) => {
      const [input] = AddDebPackageArgsSchema.parse(args)
      return debService.add(input)
    },

    updateDebPackage: async (args) => {
      const [map] = DebArgSchema.parse(args)
      await debService.update(TrackedDebPackage.fromMap(map))
      return undefined
    },

    deleteDebPackage: async (args) => {
      const [id] = IdArgSchema.parse(args)
      await debService.remove(id)
      return undefined
    },

    exportData: async (args): Promise<ExportResult> => {
      NoArgs.parse(args)
      return { path: await config.exportConfig() }
    },

    importData: async (args): Promise<ImportResult> => {
      NoArgs.parse(args)
      return { count: await config.importConfig() }
    },

    getDebugLog: async (args): Promise<DebugLogResult> => {
      NoArgs.parse(args)
      return debugLog.readTail()
    },

    clearDebugLog: async (args) => {
      NoArgs.parse(args)
      await debugLog.clear()
      return undefined
    },

    setSettings: async (args) => {
      const [input] = SetSettingsArgsSchema.parse(args)
      const current: Record<string, unknown> = { ...(await store.readSettings()) }
      for (const [key, value] of Object.entries(input)) {
        // Token keys are owned by `setGithubToken`; a settings write must never
        // smuggle a plaintext token back onto disk.
        if ((TOKEN_KEYS as readonly string[]).includes(key)) continue
        if (key === 'hasGithubToken') continue
        current[key] = value
      }
      await store.writeSettings(current)
      // Apply the logging preference immediately so the toggle takes effect
      // without a restart. The logger never reads settings back (no recursion).
      if ('enable_debug_logging' in input) {
        debugLog.setEnabled(input['enable_debug_logging'] === true)
      }
      return undefined
    },

    batchInstall: async (args): Promise<BatchOperationResultWire[]> => {
      const [appMaps, debMaps] = BatchItemsArgsSchema.parse(args)
      const total = appMaps.length + debMaps.length
      const results: BatchOperationResultWire[] = []
      let completed = 0
      let successful = 0
      let failed = 0
      const report = (method: BatchProgressEvent['method'], currentOperation: string): void =>
        deps.emit({ method, total, completed, successful, failed, currentOperation })

      for (const map of appMaps) {
        const app = TrackedApp.fromMap(map)
        report('batchInstall', app.displayName)
        try {
          const updated = await appService.install(app, {})
          successful++
          results.push({
            appName: app.displayName,
            success: true,
            error: null,
            newVersion: updated.installedVersion
          })
        } catch (error) {
          failed++
          results.push({
            appName: app.displayName,
            success: false,
            error: errorMessage(error),
            newVersion: null
          })
        }
        completed++
        report('batchInstall', app.displayName)
      }

      for (const map of debMaps) {
        const pkg = TrackedDebPackage.fromMap(map)
        report('batchInstall', pkg.effectiveDisplayName)
        try {
          const updated = await debService.install(pkg)
          successful++
          results.push({
            appName: pkg.effectiveDisplayName,
            success: true,
            error: null,
            newVersion: updated.installedVersion
          })
        } catch (error) {
          failed++
          results.push({
            appName: pkg.effectiveDisplayName,
            success: false,
            error: errorMessage(error),
            newVersion: null
          })
        }
        completed++
        report('batchInstall', pkg.effectiveDisplayName)
      }

      return results
    },

    batchDelete: async (args): Promise<BatchDeleteSummary> => {
      const [appIds, debIds] = IdsArgSchema.parse(args)
      const total = appIds.length + debIds.length
      let completed = 0
      let successful = 0
      let failed = 0
      const report = (currentOperation: string): void =>
        deps.emit({
          method: 'batchDelete',
          total,
          completed,
          successful,
          failed,
          currentOperation
        })

      const removedApps = await repo.deleteApps(appIds)
      successful += removedApps
      failed += appIds.length - removedApps
      completed += appIds.length
      report(`${appIds.length} apps`)

      const removedDebs = await repo.deleteDebs(debIds)
      successful += removedDebs
      failed += debIds.length - removedDebs
      completed += debIds.length
      report(`${debIds.length} packages`)

      return { succeeded: successful, failed }
    },

    batchUpdate: async (args): Promise<BatchOperationResultWire[]> => {
      const [appMaps, debMaps] = BatchItemsArgsSchema.parse(args)
      const total = appMaps.length + debMaps.length
      const results: BatchOperationResultWire[] = []
      let completed = 0
      let successful = 0
      let failed = 0
      const report = (currentOperation: string): void =>
        deps.emit({
          method: 'batchUpdate',
          total,
          completed,
          successful,
          failed,
          currentOperation
        })

      for (const map of appMaps) {
        const app = TrackedApp.fromMap(map)
        report(app.displayName)
        try {
          const updated = await appService.check(app)
          successful++
          results.push({
            appName: app.displayName,
            success: true,
            error: null,
            newVersion: updated.latestVersion
          })
        } catch (error) {
          failed++
          results.push({
            appName: app.displayName,
            success: false,
            error: errorMessage(error),
            newVersion: null
          })
        }
        completed++
        report(app.displayName)
      }

      for (const map of debMaps) {
        const pkg = TrackedDebPackage.fromMap(map)
        report(pkg.effectiveDisplayName)
        try {
          const newVersion = await debService.check(pkg)
          successful++
          results.push({
            appName: pkg.effectiveDisplayName,
            success: true,
            error: null,
            newVersion
          })
        } catch (error) {
          failed++
          results.push({
            appName: pkg.effectiveDisplayName,
            success: false,
            error: errorMessage(error),
            newVersion: null
          })
        }
        completed++
        report(pkg.effectiveDisplayName)
      }

      return results
    }
  }
}
