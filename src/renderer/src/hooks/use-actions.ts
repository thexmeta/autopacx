// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult
} from '@tanstack/react-query'
import type { TrackedApp } from '@core/models/tracked-app'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import type { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import type {
  AddAppInput,
  AddDebPackageInput,
  BatchDeleteSummary,
  BatchOperationResultWire,
  BatchUpdateResult,
  ExportResult,
  ImportResult,
  InstallOptions,
  Settings
} from '@core/index'
import { useNotifications } from '@renderer/src/components/notifications'
import { errorMessage } from '@renderer/src/lib/errors'

/** Query keys invalidated after a mutation that changes tracked items. */
const ITEM_KEYS: QueryKey[] = [['apps'], ['debPackages']]
const SETTINGS_KEYS: QueryKey[] = [['settings']]

type WriteOptions = {
  /** Query keys to invalidate on success; defaults to the tracked-item lists. */
  invalidate?: QueryKey[]
  /** Human label used to prefix the error notification. */
  errorLabel: string
}

/**
 * Wraps `useMutation` with the two behaviours every write shares: invalidate
 * the affected queries so the lists refetch, and surface a persistent error
 * notification when the IPC call rejects.
 */
export function useWrite<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: WriteOptions
): UseMutationResult<TData, Error, TVariables> {
  const queryClient = useQueryClient()
  const { notify } = useNotifications()

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    onSuccess: () => {
      for (const key of options.invalidate ?? ITEM_KEYS) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (error) => {
      notify({ tone: 'error', message: `${options.errorLabel} failed: ${errorMessage(error)}` })
    }
  })
}

export type BatchItemsInput = {
  apps: TrackedApp[]
  debPackages: TrackedDebPackage[]
  pacstallPackages?: TrackedPacstallPackage[]
}

/** Variables for {@link useActions}'s `installApp` mutation. */
export type InstallAppVariables = {
  app: TrackedApp
  /** Optional destination/binary name for a raw-binary install. */
  options?: InstallOptions
}

/**
 * Every renderer-initiated write, as react-query mutations.
 *
 * Components call `mutation.mutate(...)`/`mutateAsync(...)`; a mutation's
 * `isPending` and `variables` drive per-row button disabling, and its result
 * feeds success notifications. All writes funnel through `window.autopacx`
 * so the renderer never touches Node or Electron directly.
 */
export function useActions(): {
  installApp: UseMutationResult<unknown, Error, InstallAppVariables>
  uninstallApp: UseMutationResult<void, Error, TrackedApp>
  launchApp: UseMutationResult<void, Error, TrackedApp>
  checkAppUpdate: UseMutationResult<unknown, Error, TrackedApp>
  deleteApp: UseMutationResult<void, Error, number>
  addApp: UseMutationResult<number, Error, AddAppInput>
  updateApp: UseMutationResult<void, Error, TrackedApp>
  installDeb: UseMutationResult<unknown, Error, TrackedDebPackage>
  uninstallDeb: UseMutationResult<void, Error, TrackedDebPackage>
  launchDeb: UseMutationResult<void, Error, TrackedDebPackage>
  checkDebUpdate: UseMutationResult<string | null, Error, TrackedDebPackage>
  deleteDeb: UseMutationResult<void, Error, number>
  addDebPackage: UseMutationResult<number, Error, AddDebPackageInput>
  updateDebPackage: UseMutationResult<void, Error, TrackedDebPackage>
  checkAll: UseMutationResult<BatchUpdateResult, Error, void>
  batchInstall: UseMutationResult<BatchOperationResultWire[], Error, BatchItemsInput>
  batchDelete: UseMutationResult<
    BatchDeleteSummary,
    Error,
    { appIds: number[]; debIds: number[]; pacstallIds?: number[] }
  >
  batchUpdate: UseMutationResult<BatchOperationResultWire[], Error, BatchItemsInput>
  exportData: UseMutationResult<ExportResult, Error, void>
  importData: UseMutationResult<ImportResult, Error, void>
  openExternal: UseMutationResult<void, Error, string>
  setGithubToken: UseMutationResult<void, Error, string>
  setSettings: UseMutationResult<void, Error, Settings>
} {
  const installApp = useWrite(
    ({ app, options }: InstallAppVariables) =>
      // Pass the second argument only when options are supplied, so the common
      // "install latest" path stays a single-argument call.
      options === undefined
        ? window.autopacx.installApp(app.toMap())
        : window.autopacx.installApp(app.toMap(), options),
    { errorLabel: 'Install' }
  )
  const uninstallApp = useWrite((app: TrackedApp) => window.autopacx.uninstallApp(app.toMap()), {
    errorLabel: 'Uninstall'
  })
  const launchApp = useWrite((app: TrackedApp) => window.autopacx.launchApp(app.toMap()), {
    errorLabel: 'Launch'
  })
  const checkAppUpdate = useWrite((app: TrackedApp) => window.autopacx.checkAppUpdate(app.toMap()), {
    errorLabel: 'Check for updates'
  })
  const deleteApp = useWrite((id: number) => window.autopacx.deleteApp(id), {
    errorLabel: 'Delete'
  })
  const addApp = useWrite((input: AddAppInput) => window.autopacx.addApp(input), {
    errorLabel: 'Add app'
  })
  const updateApp = useWrite((app: TrackedApp) => window.autopacx.updateApp(app.toMap()), {
    errorLabel: 'Update app'
  })

  const installDeb = useWrite((pkg: TrackedDebPackage) => window.autopacx.installDeb(pkg.toMap()), {
    errorLabel: 'Install'
  })
  const uninstallDeb = useWrite(
    (pkg: TrackedDebPackage) => window.autopacx.uninstallDebPackage(pkg.toMap()),
    { errorLabel: 'Uninstall' }
  )
  const launchDeb = useWrite((pkg: TrackedDebPackage) => window.autopacx.launchDeb(pkg.toMap()), {
    errorLabel: 'Launch'
  })
  const checkDebUpdate = useWrite(
    (pkg: TrackedDebPackage) => window.autopacx.checkDebUpdate(pkg.toMap()),
    { errorLabel: 'Check for updates' }
  )
  const deleteDeb = useWrite((id: number) => window.autopacx.deleteDebPackage(id), {
    errorLabel: 'Delete'
  })
  const addDebPackage = useWrite(
    (input: AddDebPackageInput) => window.autopacx.addDebPackage(input),
    { errorLabel: 'Add package' }
  )
  const updateDebPackage = useWrite(
    (pkg: TrackedDebPackage) => window.autopacx.updateDebPackage(pkg.toMap()),
    { errorLabel: 'Update package' }
  )

  const checkAll = useWrite<void, BatchUpdateResult>(() => window.autopacx.checkAllUpdates(), {
    errorLabel: 'Check all updates'
  })
  const batchInstall = useWrite(
    ({ apps, debPackages }: BatchItemsInput) =>
      window.autopacx.batchInstall(
        apps.map((app) => app.toMap()),
        debPackages.map((pkg) => pkg.toMap()),
        []
      ),
    { errorLabel: 'Batch install' }
  )
  const batchDelete = useWrite(
    ({ appIds, debIds }: { appIds: number[]; debIds: number[] }) =>
      window.autopacx.batchDelete(appIds, debIds, []),
    { errorLabel: 'Batch delete' }
  )
  const batchUpdate = useWrite(
    ({ apps, debPackages }: BatchItemsInput) =>
      window.autopacx.batchUpdate(
        apps.map((app) => app.toMap()),
        debPackages.map((pkg) => pkg.toMap()),
        []
      ),
    { errorLabel: 'Batch update' }
  )

  const exportData = useWrite<void, ExportResult>(() => window.autopacx.exportData(), {
    errorLabel: 'Export',
    invalidate: []
  })
  const importData = useWrite<void, ImportResult>(() => window.autopacx.importData(), {
    errorLabel: 'Import'
  })

  const openExternal = useWrite((url: string) => window.autopacx.openExternal(url), {
    errorLabel: 'Open link',
    invalidate: []
  })

  const setGithubToken = useWrite((token: string) => window.autopacx.setGithubToken(token), {
    errorLabel: 'Save token',
    invalidate: SETTINGS_KEYS
  })
  const setSettings = useWrite((settings: Settings) => window.autopacx.setSettings(settings), {
    errorLabel: 'Save settings',
    invalidate: SETTINGS_KEYS
  })

  return {
    installApp,
    uninstallApp,
    launchApp,
    checkAppUpdate,
    deleteApp,
    addApp,
    updateApp,
    installDeb,
    uninstallDeb,
    launchDeb,
    checkDebUpdate,
    deleteDeb,
    addDebPackage,
    updateDebPackage,
    checkAll,
    batchInstall,
    batchDelete,
    batchUpdate,
    exportData,
    importData,
    openExternal,
    setGithubToken,
    setSettings
  }
}
