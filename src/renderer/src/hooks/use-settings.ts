// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { GitHubRepoSearchSort, MaskedSettings } from '@core/index'

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

// --- GitHub repository-search defaults --------------------------------------

export const DEFAULT_GITHUB_SEARCH_SORT: GitHubRepoSearchSort = 'best-match'
export const DEFAULT_GITHUB_SEARCH_PER_PAGE = 30

export const GITHUB_SEARCH_SORT_OPTIONS: readonly {
  value: GitHubRepoSearchSort
  label: string
}[] = [
  { value: 'best-match', label: 'Best match' },
  { value: 'stars', label: 'Most stars' },
  { value: 'updated', label: 'Recently updated' }
]

/** Coerces a persisted sort value into a supported {@link GitHubRepoSearchSort}. */
export function resolveGithubSearchSort(value: unknown): GitHubRepoSearchSort {
  return value === 'stars' || value === 'updated' || value === 'best-match'
    ? value
    : DEFAULT_GITHUB_SEARCH_SORT
}

/** Coerces a persisted per-page value into `[1, 100]`, defaulting to 30. */
export function resolveGithubSearchPerPage(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_GITHUB_SEARCH_PER_PAGE
  return Math.min(Math.trunc(parsed), 100)
}

/** The effective GitHub search defaults, with documented fallbacks applied. */
export function useGithubSearchDefaults(): {
  sort: GitHubRepoSearchSort
  perPage: number
} {
  const { data } = useSettings()
  return {
    sort: resolveGithubSearchSort(data?.github_search_sort),
    perPage: resolveGithubSearchPerPage(data?.github_search_per_page)
  }
}
