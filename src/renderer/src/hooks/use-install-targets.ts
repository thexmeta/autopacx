// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { GetInstallTargetsInput, InstallTargetsResultWire } from '@core/index'

/** The react-query key for one app's install-target suggestions. */
export function installTargetsQueryKey(input: GetInstallTargetsInput): readonly unknown[] {
  return ['installTargets', input.name, input.installType ?? null]
}

/**
 * Loads the directories a raw-binary install could target, best first, with
 * each candidate's writability, PATH membership and package ownership already
 * resolved by the main process.
 */
export function useInstallTargets(
  input: GetInstallTargetsInput
): UseQueryResult<InstallTargetsResultWire, Error> {
  return useQuery({
    queryKey: installTargetsQueryKey(input),
    queryFn: () => window.autonex.getInstallTargets(input)
  })
}
