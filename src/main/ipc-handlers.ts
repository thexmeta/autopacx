// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { clipboard } from 'electron'
import type {
  AddPacstallPackageInput,
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
  OperationProgressEvent,
  PacstallBatchUpdateResult,
  Settings
} from '@core/api'
import { DEFAULT_ARCH_TYPES } from '@core/api'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { AppService } from './services/app-service'
import { DebService } from './services/deb-service'
import { TrackedRepository } from './services/tracked-repository'
import {
  DEFAULT_INDEX_TTL_HOURS,
  DEFAULT_REGISTRY_BRANCH,
  DEFAULT_REGISTRY_REPO
} from './services/pacstall-registry'
import type {
  ConfigLike,
  DatabaseLike,
  DebugLogLike,
  ExternalCheckerLike,
  ExternalLinkLike,
  GitHubLike,
  InstallLocationLike,
  InstallerLike,
  PacstallLike,
  PacstallRegistryPort,
  StoreLike,
  TokenLike
} from './services/ports'
import {
  AddAppArgsSchema,
  AddDebPackageArgsSchema,
  AddPacstallPackageArgsSchema,
  AppArgSchema,
  AppArgWithOptionsSchema,
  BatchItemsArgsSchema,
  DebArgSchema,
  GetGithubReleaseAssetsArgsSchema,
  GetInstallTargetsArgsSchema,
  GetPacstallIndexArgsSchema,
  IdArgSchema,
  IdsArgSchema,
  NoArgs,
  OpenExternalArgsSchema,
  PacstallArgSchema,
  PacstallNameArgSchema,
  SearchGithubRepositoriesArgsSchema,
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
  InstallLocationLike,
  InstallerLike,
  PacstallLike,
  PacstallRegistryPort,
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
  /** pacstall lifecycle operations (install/remove/upgrade/check/launch). */
  readonly pacstall: PacstallLike
  /** pacstall registry index/metadata lookups. */
  readonly pacstallRegistry: PacstallRegistryPort
  /** Suggests directories a raw-binary install could target. */
  readonly installLocation: InstallLocationLike
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
 * Defaults for settings keys the UI expects to always resolve. Applied on read
 * (under the persisted map) so the renderer never has to guess a fallback.
 */
export const SETTINGS_DEFAULTS: Readonly<Record<string, unknown>> = {
  pacstall_enabled: false,
  pacstall_registry_repo: DEFAULT_REGISTRY_REPO,
  pacstall_registry_branch: DEFAULT_REGISTRY_BRANCH,
  pacstall_index_ttl_hours: DEFAULT_INDEX_TTL_HOURS,
  pacstall_detected: false,
  pacstall_version: null,
  github_search_sort: 'best-match',
  github_search_per_page: 30,
  default_architectures: [],
  default_install_type: '',
  default_arch_type: [...DEFAULT_ARCH_TYPES],
  default_asset_filter_pattern: '',
  default_binary_install_dir: '~/.local/bin'
}

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
  const { store, installer, token, config, debugLog, pacstall, pacstallRegistry } = deps

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

  /**
   * Wraps a single long-running operation so it emits a `starting` then a
   * `done`/`failed` {@link OperationProgressEvent} on the event channel. The
   * failure event carries the error message as `detail` and the error is
   * re-thrown so the IPC layer still rejects the caller.
   */
  const withProgress = async <T>(
    method: OperationProgressEvent['method'],
    name: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    deps.emit({ kind: 'operation', method, phase: 'starting', name, completed: 0, total: 1 })
    try {
      const result = await fn()
      deps.emit({ kind: 'operation', method, phase: 'done', name, completed: 1, total: 1 })
      return result
    } catch (error) {
      deps.emit({
        kind: 'operation',
        method,
        phase: 'failed',
        name,
        completed: 1,
        total: 1,
        detail: errorMessage(error)
      })
      throw error
    }
  }

  const listApps = async (): Promise<Record<string, unknown>[]> =>
    (await repo.listApps()).map((app) => app.toMap())
  const listDebs = async (): Promise<Record<string, unknown>[]> =>
    (await repo.listDebs()).map((pkg) => pkg.toMap())
  const listPacstall = async (): Promise<Record<string, unknown>[]> =>
    (await repo.listPacstallPackages()).map((pkg) => pkg.toMap())

  /** Registers a new tracked pacstall package; throws when already tracked. */
  const addPacstall = async (input: AddPacstallPackageInput): Promise<number> => {
    const existing = await repo.listPacstallPackages()
    if (existing.some((pkg) => pkg.name === input.name)) {
      throw new Error('Pacstall package already exists')
    }
    const settings = await store.readSettings()
    const configuredRepo = settings['pacstall_registry_repo']
    const registryRepo =
      typeof configuredRepo === 'string' && configuredRepo.length > 0
        ? configuredRepo
        : DEFAULT_REGISTRY_REPO
    const pkg = new TrackedPacstallPackage({
      name: input.name,
      displayName: input.displayName ?? input.name,
      createdAt: new Date(),
      autoUpdate: input.autoUpdate ?? false,
      launchCommand: input.launchCommand ?? null,
      packageName: input.packageName ?? null,
      registryRepo
    })
    return repo.appendPacstallPackage(pkg)
  }

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
      const withDefaults: Settings = { ...SETTINGS_DEFAULTS, ...settings }
      return maskSettings(withDefaults, await token.hasToken())
    },

    getVersion: async (args) => {
      NoArgs.parse(args)
      return deps.appVersion
    },

    readClipboardText: async (args) => {
      NoArgs.parse(args)
      return clipboard.readText()
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
      const app = TrackedApp.fromMap(map)
      return withProgress('installApp', app.displayName, async () => {
        const updated = await appService.install(app, options ?? {})
        return updated.toMap()
      })
    },

    installDeb: async (args) => {
      const [map] = DebArgSchema.parse(args)
      const pkg = TrackedDebPackage.fromMap(map)
      return withProgress('installDeb', pkg.effectiveDisplayName, async () => {
        const updated = await debService.install(pkg)
        return updated.toMap()
      })
    },

    uninstallApp: async (args) => {
      const [map] = AppArgSchema.parse(args)
      const app = TrackedApp.fromMap(map)
      return withProgress('uninstallApp', app.displayName, async () => {
        await installer.uninstallPackage(app)
        // Clear the persisted install state so the row no longer reports the
        // package as installed (restores the Dart `home_screen.dart` behaviour).
        const updated = app.copyWith({
          installedVersion: null,
          installType: null,
          launchCommand: null,
          packageName: null,
          lastChecked: new Date()
        })
        await repo.updateApp(updated)
        return undefined
      })
    },

    uninstallDebPackage: async (args) => {
      const [map] = DebArgSchema.parse(args)
      const pkg = TrackedDebPackage.fromMap(map)
      return withProgress('uninstallDebPackage', pkg.effectiveDisplayName, async () => {
        await installer.uninstallDebPackage(pkg)
        const updated = pkg.copyWith({
          installedVersion: null,
          launchCommand: null,
          packageName: null,
          lastChecked: new Date()
        })
        await repo.updateDeb(updated)
        return undefined
      })
    },

    checkAppUpdate: async (args) => {
      const [map] = AppArgSchema.parse(args)
      const app = TrackedApp.fromMap(map)
      return withProgress('checkAppUpdate', app.displayName, async () => {
        const updated = await appService.check(app)
        return updated.toMap()
      })
    },

    checkDebUpdate: async (args) => {
      const [map] = DebArgSchema.parse(args)
      const pkg = TrackedDebPackage.fromMap(map)
      return withProgress('checkDebUpdate', pkg.effectiveDisplayName, () =>
        debService.check(pkg)
      )
    },

    checkAllUpdates: async (args): Promise<BatchUpdateResult> => {
      NoArgs.parse(args)
      const apps = await repo.listApps()
      const debs = await repo.listDebs()
      const pacstallPackages = await repo.listPacstallPackages()
      const total = apps.length + debs.length + pacstallPackages.length
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

      for (const pkg of pacstallPackages) {
        report(pkg.effectiveDisplayName)
        try {
          const newVersion = await pacstall.checkUpdate(pkg)
          await repo.updatePacstallPackage(
            pkg.copyWith({
              latestVersion: newVersion ?? pkg.latestVersion,
              lastChecked: new Date()
            })
          )
          successful++
        } catch (error) {
          failed++
          failures.push({ name: pkg.effectiveDisplayName, error: errorMessage(error) })
        }
        completed++
        report(pkg.effectiveDisplayName)
      }

      return {
        apps: await listApps(),
        debPackages: await listDebs(),
        pacstallPackages: await listPacstall(),
        failures
      }
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

    searchGithubRepositories: async (args) => {
      const [input] = SearchGithubRepositoriesArgsSchema.parse(args)
      return deps.github.searchRepositories(input.query, {
        sort: input.sort == null || input.sort === 'best-match' ? null : input.sort,
        perPage: input.perPage ?? null,
        page: input.page ?? null
      })
    },

    getGithubReleaseAssets: async (args) => {
      const [input] = GetGithubReleaseAssetsArgsSchema.parse(args)
      return deps.github.getGithubReleaseAssets(input.repoOwner, input.repoName, {
        includePrerelease: input.includePrerelease === true,
        assetFilterPattern: input.assetFilterPattern,
        tagPrefix: input.tagPrefix,
        architectures: input.architectures
      })
    },

    getInstallTargets: async (args) => {
      const [input] = GetInstallTargetsArgsSchema.parse(args)
      // The suggester only needs the app's identity; the repo/display names
      // drive the app-specific `/opt/<name>/bin` candidate.
      const app = new TrackedApp({
        repoOwner: '',
        repoName: input.name,
        displayName: input.name,
        createdAt: new Date()
      })
      const candidates = await deps.installLocation.suggestTargets(app)
      const recommended = candidates.find((candidate) => candidate.recommended) ?? null
      return { candidates, defaultPath: recommended?.path ?? null }
    },

    getPacstallStatus: async (args) => {
      NoArgs.parse(args)
      const status = await pacstall.status()
      const settings = await store.readSettings()
      return { ...status, enabled: settings['pacstall_enabled'] === true }
    },

    getPacstallIndex: async (args) => {
      const [options] = GetPacstallIndexArgsSchema.parse(args)
      return pacstallRegistry.fetchIndex({ force: options?.force === true })
    },

    getPacstallPackageInfo: async (args) => {
      const [input] = PacstallNameArgSchema.parse(args)
      return pacstallRegistry.fetchPackageInfo(input.name)
    },

    getPacstallPackages: async (args) => {
      NoArgs.parse(args)
      return listPacstall()
    },

    addPacstallPackage: async (args) => {
      const [input] = AddPacstallPackageArgsSchema.parse(args)
      return addPacstall(input)
    },

    installPacstallPackage: async (args) => {
      const [map] = PacstallArgSchema.parse(args)
      const pkg = TrackedPacstallPackage.fromMap(map)
      await pacstall.install(pkg.name)
      const installed = await pacstall.readInstalledVersion(pkg.name)
      const updated = pkg.copyWith({
        installedVersion: installed === 'unknown' ? pkg.installedVersion : installed,
        lastChecked: new Date()
      })
      await repo.updatePacstallPackage(updated)
      return updated.toMap()
    },

    uninstallPacstallPackage: async (args) => {
      const [map] = PacstallArgSchema.parse(args)
      await pacstall.remove(TrackedPacstallPackage.fromMap(map).name)
      return undefined
    },

    checkPacstallUpdate: async (args) => {
      const [map] = PacstallArgSchema.parse(args)
      const pkg = TrackedPacstallPackage.fromMap(map)
      const newVersion = await pacstall.checkUpdate(pkg)
      await repo.updatePacstallPackage(
        pkg.copyWith({ latestVersion: newVersion ?? pkg.latestVersion, lastChecked: new Date() })
      )
      return newVersion
    },

    updatePacstallPackage: async (args) => {
      const [map] = PacstallArgSchema.parse(args)
      const pkg = TrackedPacstallPackage.fromMap(map)
      await pacstall.upgrade(pkg.name)
      const installed = await pacstall.readInstalledVersion(pkg.name)
      await repo.updatePacstallPackage(
        pkg.copyWith({
          installedVersion: installed === 'unknown' ? pkg.installedVersion : installed,
          lastChecked: new Date()
        })
      )
      return undefined
    },

    deletePacstallPackage: async (args) => {
      const [id] = IdArgSchema.parse(args)
      await repo.deletePacstallPackage(id)
      return undefined
    },

    launchPacstall: async (args) => {
      const [map] = PacstallArgSchema.parse(args)
      await pacstall.launch(TrackedPacstallPackage.fromMap(map))
      return undefined
    },

    checkPacstallAllUpdates: async (args): Promise<PacstallBatchUpdateResult> => {
      NoArgs.parse(args)
      const packages = await repo.listPacstallPackages()
      const failures: BatchUpdateFailure[] = []
      for (const pkg of packages) {
        try {
          const newVersion = await pacstall.checkUpdate(pkg)
          await repo.updatePacstallPackage(
            pkg.copyWith({
              latestVersion: newVersion ?? pkg.latestVersion,
              lastChecked: new Date()
            })
          )
        } catch (error) {
          failures.push({ name: pkg.effectiveDisplayName, error: errorMessage(error) })
        }
      }
      return { packages: await listPacstall(), failures }
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
      const [appMaps, debMaps, pacstallMaps] = BatchItemsArgsSchema.parse(args)
      const total = appMaps.length + debMaps.length + pacstallMaps.length
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

      for (const map of pacstallMaps) {
        const pkg = TrackedPacstallPackage.fromMap(map)
        report('batchInstall', pkg.effectiveDisplayName)
        try {
          await pacstall.install(pkg.name)
          const installed = await pacstall.readInstalledVersion(pkg.name)
          const updated = pkg.copyWith({
            installedVersion: installed === 'unknown' ? pkg.installedVersion : installed,
            lastChecked: new Date()
          })
          await repo.updatePacstallPackage(updated)
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
      const [appIds, debIds, pacstallIds] = IdsArgSchema.parse(args)
      const total = appIds.length + debIds.length + pacstallIds.length
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

      const removedPacstall = await repo.deletePacstallPackages(pacstallIds)
      successful += removedPacstall
      failed += pacstallIds.length - removedPacstall
      completed += pacstallIds.length
      report(`${pacstallIds.length} pacstall packages`)

      return { succeeded: successful, failed }
    },

    batchUpdate: async (args): Promise<BatchOperationResultWire[]> => {
      const [appMaps, debMaps, pacstallMaps] = BatchItemsArgsSchema.parse(args)
      const total = appMaps.length + debMaps.length + pacstallMaps.length
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

      for (const map of pacstallMaps) {
        const pkg = TrackedPacstallPackage.fromMap(map)
        report(pkg.effectiveDisplayName)
        try {
          const newVersion = await pacstall.checkUpdate(pkg)
          await repo.updatePacstallPackage(
            pkg.copyWith({
              latestVersion: newVersion ?? pkg.latestVersion,
              lastChecked: new Date()
            })
          )
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
