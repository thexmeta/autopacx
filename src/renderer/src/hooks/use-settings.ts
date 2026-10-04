// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { MaskedSettings } from '@core/index'

/** Loads the masked settings (the plaintext token is never part of this shape). */
export function useSettings(): UseQueryResult<MaskedSettings, Error> {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => window.autonex.getSettings()
  })
}

/** Whether a GitHub token is configured, without ever reading its value. */
export function useHasGithubToken(): UseQueryResult<boolean, Error> {
  return useQuery({
    queryKey: ['hasGithubToken'],
    queryFn: () => window.autonex.hasGithubToken()
  })
}
