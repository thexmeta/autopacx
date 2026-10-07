// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { GitHubRepoSearchResultWire, GitHubRepoSearchSort } from '@core/index'

/** How long the search box waits after the last keystroke before querying. */
export const GITHUB_SEARCH_DEBOUNCE_MS = 400

/** The shortest query that triggers a request; 1-character searches are useless. */
export const GITHUB_SEARCH_MIN_QUERY_LENGTH = 2

/** One page of results together with the query/page that produced it. */
export interface GithubSearchPage {
  readonly query: string
  readonly page: number
  readonly result: GitHubRepoSearchResultWire
}

/**
 * The react-query key for one page of a search. Exported so a caller can read
 * sibling pages straight from the query cache (e.g. to accumulate "load more"
 * pages) without duplicating the key shape.
 */
export function githubSearchQueryKey(options: {
  readonly query: string
  readonly sort?: GitHubRepoSearchSort
  readonly perPage?: number
  readonly page: number
}): readonly unknown[] {
  return [
    'githubSearch',
    options.query,
    options.sort ?? 'best-match',
    options.perPage ?? null,
    options.page
  ]
}

/** Debounces a value, returning the latest value only after `delayMs` of quiet. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export type UseGithubSearchOptions = {
  readonly query: string
  readonly sort?: GitHubRepoSearchSort
  readonly perPage?: number
  readonly page?: number
  readonly debounceMs?: number
}

export type UseGithubSearchResult = UseQueryResult<GithubSearchPage, Error> & {
  /** The debounced query actually sent to GitHub. */
  readonly debouncedQuery: string
  /** Whether a long-enough query is still waiting out the debounce window. */
  readonly isDebouncing: boolean
}

/**
 * Debounced GitHub repository search.
 *
 * The query is only issued once it is at least
 * {@link GITHUB_SEARCH_MIN_QUERY_LENGTH} characters and has been quiet for
 * {@link GITHUB_SEARCH_DEBOUNCE_MS}; each page is its own cache entry, so
 * "load more" appends without refetching earlier pages. The page wraps the
 * result with the query/page that produced it so callers can discard a stale
 * response that arrives after the user has typed again.
 */
export function useGithubSearch(options: UseGithubSearchOptions): UseGithubSearchResult {
  const { query, sort, perPage, page = 1, debounceMs = GITHUB_SEARCH_DEBOUNCE_MS } = options
  const trimmed = query.trim()
  const debouncedQuery = useDebouncedValue(trimmed, debounceMs)
  const enabled = debouncedQuery.length >= GITHUB_SEARCH_MIN_QUERY_LENGTH

  const result = useQuery<GithubSearchPage, Error>({
    queryKey: githubSearchQueryKey({ query: debouncedQuery, sort, perPage, page }),
    queryFn: async () => ({
      query: debouncedQuery,
      page,
      result: await window.autonex.searchGithubRepositories({
        query: debouncedQuery,
        ...(sort != null ? { sort } : {}),
        ...(perPage != null ? { perPage } : {}),
        page
      })
    }),
    enabled,
    placeholderData: keepPreviousData
  })

  return {
    ...result,
    debouncedQuery,
    isDebouncing: enabled && debouncedQuery !== trimmed
  }
}

/** Rate-limit hints recovered from a rejected search. */
export interface GithubRateLimitInfo {
  /** When the limit resets, derived from the `reset` hint, or `null`. */
  readonly resetAt: Date | null
  /** `Retry-After` seconds, when the response carried one, or `null`. */
  readonly retryAfterSeconds: number | null
}

/**
 * Recognises the rate-limit rejection raised by the main process.
 *
 * Electron's structured clone drops custom `Error` fields, so
 * `GitHubRateLimitError` folds the reset/retry hints into its message; this
 * parses them back out so the UI can tell the user when to retry.
 */
export function parseGithubRateLimit(error: unknown): GithubRateLimitInfo | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!/rate limit/i.test(message)) return null

  const resetMatch = /\breset (\d+)/.exec(message)
  const retryMatch = /\bretry-after (\d+)/.exec(message)
  const resetSeconds = resetMatch != null ? Number.parseInt(resetMatch[1], 10) : Number.NaN
  const retrySeconds = retryMatch != null ? Number.parseInt(retryMatch[1], 10) : Number.NaN

  return {
    resetAt: Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000) : null,
    retryAfterSeconds: Number.isFinite(retrySeconds) ? retrySeconds : null
  }
}
