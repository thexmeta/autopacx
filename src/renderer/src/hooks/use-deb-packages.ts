// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import type { TrackedDebPackageWire } from '@core/index'

/**
 * Rebuilds `TrackedDebPackage` models from their wire maps, restoring the
 * `hasUpdate`, `filename` and `effectiveDisplayName` getters.
 */
export function rehydrateDebPackages(wire: readonly TrackedDebPackageWire[]): TrackedDebPackage[] {
  return wire.map((map) => TrackedDebPackage.fromMap(map))
}

/** Loads the tracked deb packages over the preload bridge and rehydrates them. */
export function useDebPackages(): UseQueryResult<TrackedDebPackage[], Error> {
  return useQuery({
    queryKey: ['debPackages'],
    queryFn: async () => rehydrateDebPackages(await window.autonex.getDebPackages())
  })
}
