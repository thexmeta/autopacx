// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { TrackedApp } from '@core/models/tracked-app'
import type { TrackedAppWire } from '@core/index'

/**
 * Rebuilds `TrackedApp` models from the snake_case wire maps the IPC layer
 * returns, restoring the prototype getters (`hasUpdate`, `isInstalled`,
 * `repoUrl`) that Electron's structured clone drops.
 */
export function rehydrateApps(wire: readonly TrackedAppWire[]): TrackedApp[] {
  return wire.map((map) => TrackedApp.fromMap(map))
}

/** Loads the tracked apps over the preload bridge and rehydrates them. */
export function useApps(): UseQueryResult<TrackedApp[], Error> {
  return useQuery({
    queryKey: ['apps'],
    queryFn: async () => rehydrateApps(await window.autonex.getApps())
  })
}
