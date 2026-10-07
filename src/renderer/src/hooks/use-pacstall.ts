// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import {
  useQuery,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import type {
  AddPacstallPackageInput,
  PacstallBatchUpdateResult,
  PacstallIndexWire,
  PacstallPackageInfoWire,
  PacstallStatusWire,
  TrackedPacstallPackageWire
} from '@core/index'
import { useWrite } from './use-actions'

/** Query keys invalidated after a write that changes pacstall state. */
const PACSTALL_KEYS: QueryKey[] = [['pacstallPackages'], ['pacstallStatus']]

/** Whether pacstall is installed (and enabled) and where it resolved. */
export function usePacstallStatus(): UseQueryResult<PacstallStatusWire, Error> {
  return useQuery({
    queryKey: ['pacstallStatus'],
    queryFn: () => window.autopacx.getPacstallStatus()
  })
}

/** The registry package-name index, served from the on-disk cache when fresh. */
export function usePacstallIndex(): UseQueryResult<PacstallIndexWire, Error> {
  return useQuery({
    queryKey: ['pacstallIndex'],
    queryFn: () => window.autopacx.getPacstallIndex()
  })
}

/**
 * A single package's parsed `.SRCINFO`. Lazy: it only fires when `name` is set,
 * so an expanded row triggers the fetch and a collapsed one does not.
 */
export function usePacstallPackageInfo(
  name: string | null
): UseQueryResult<PacstallPackageInfoWire, Error> {
  return useQuery({
    queryKey: ['pacstallPackageInfo', name],
    queryFn: () => window.autopacx.getPacstallPackageInfo({ name: name ?? '' }),
    enabled: name != null && name.length > 0
  })
}

/** Rebuilds `TrackedPacstallPackage` models, restoring their prototype getters. */
export function rehydratePacstallPackages(
  wire: readonly TrackedPacstallPackageWire[]
): TrackedPacstallPackage[] {
  return wire.map((map) => TrackedPacstallPackage.fromMap(map))
}

/** Loads every tracked pacstall package over the preload bridge. */
export function usePacstallPackages(): UseQueryResult<TrackedPacstallPackage[], Error> {
  return useQuery({
    queryKey: ['pacstallPackages'],
    queryFn: async () => rehydratePacstallPackages(await window.autopacx.getPacstallPackages())
  })
}

export type PacstallActions = {
  addPacstall: UseMutationResult<number, Error, AddPacstallPackageInput>
  installPacstall: UseMutationResult<TrackedPacstallPackageWire, Error, TrackedPacstallPackage>
  uninstallPacstall: UseMutationResult<void, Error, TrackedPacstallPackage>
  launchPacstall: UseMutationResult<void, Error, TrackedPacstallPackage>
  checkPacstallUpdate: UseMutationResult<string | null, Error, TrackedPacstallPackage>
  updatePacstall: UseMutationResult<void, Error, TrackedPacstallPackage>
  deletePacstall: UseMutationResult<void, Error, number>
  checkPacstallAll: UseMutationResult<PacstallBatchUpdateResult, Error, void>
}

/**
 * Every pacstall write, as react-query mutations built on the shared
 * {@link useWrite} behaviour (invalidate the pacstall queries, surface a
 * persistent error notification). Kept here rather than in `useActions` so the
 * pacstall surface has one import for its queries and its writes.
 */
export function usePacstallActions(): PacstallActions {
  const addPacstall = useWrite(
    (input: AddPacstallPackageInput) => window.autopacx.addPacstallPackage(input),
    { errorLabel: 'Add pacstall package', invalidate: PACSTALL_KEYS }
  )
  const installPacstall = useWrite(
    (pkg: TrackedPacstallPackage) => window.autopacx.installPacstallPackage(pkg.toMap()),
    { errorLabel: 'Install', invalidate: PACSTALL_KEYS }
  )
  const uninstallPacstall = useWrite(
    (pkg: TrackedPacstallPackage) => window.autopacx.uninstallPacstallPackage(pkg.toMap()),
    { errorLabel: 'Uninstall', invalidate: PACSTALL_KEYS }
  )
  const launchPacstall = useWrite(
    (pkg: TrackedPacstallPackage) => window.autopacx.launchPacstall(pkg.toMap()),
    { errorLabel: 'Launch', invalidate: [] }
  )
  const checkPacstallUpdate = useWrite(
    (pkg: TrackedPacstallPackage) => window.autopacx.checkPacstallUpdate(pkg.toMap()),
    { errorLabel: 'Check for updates', invalidate: PACSTALL_KEYS }
  )
  const updatePacstall = useWrite(
    (pkg: TrackedPacstallPackage) => window.autopacx.updatePacstallPackage(pkg.toMap()),
    { errorLabel: 'Update', invalidate: PACSTALL_KEYS }
  )
  const deletePacstall = useWrite((id: number) => window.autopacx.deletePacstallPackage(id), {
    errorLabel: 'Delete',
    invalidate: PACSTALL_KEYS
  })
  const checkPacstallAll = useWrite<void, PacstallBatchUpdateResult>(
    () => window.autopacx.checkPacstallAllUpdates(),
    { errorLabel: 'Check pacstall updates', invalidate: PACSTALL_KEYS }
  )

  return {
    addPacstall,
    installPacstall,
    uninstallPacstall,
    launchPacstall,
    checkPacstallUpdate,
    updatePacstall,
    deletePacstall,
    checkPacstallAll
  }
}
