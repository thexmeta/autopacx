// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { lazy, Suspense, useMemo, useState, type JSX } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GitHubRepoSummaryWire, InstallOptions } from '@core/index'
import { TrackedApp } from '@core/models/tracked-app'
import { useActions } from '@renderer/src/hooks/use-actions'
import {
  GITHUB_SEARCH_MIN_QUERY_LENGTH,
  githubSearchQueryKey,
  parseGithubRateLimit,
  useGithubSearch,
  type GithubSearchPage
} from '@renderer/src/hooks/use-github-search'
import { useGithubSearchDefaults } from '@renderer/src/hooks/use-settings'
import { cn } from '@renderer/src/lib/cn'
import { GithubAssetDialog } from './github-asset-dialog'
import { DialogFallback } from './lazy-dialog'
import { SearchField } from './search-field'
import { Badge, Button, EmptyState, Spinner } from './ui'

// Split into its own chunk and fetched the first time the dialog is opened, so
// the shared install-options surface stays out of the main bundle.
const InstallOptionsDialog = lazy(() =>
  import('./install-options-dialog').then((module) => ({ default: module.InstallOptionsDialog }))
)

/** GitHub's search API never returns more than 1000 results for a query. */
const GITHUB_SEARCH_RESULT_CAP = 1000

/** Splits `owner/name`, tolerating a malformed value. */
function splitFullName(fullName: string): { owner: string; name: string } {
  const slash = fullName.indexOf('/')
  if (slash <= 0) return { owner: '', name: fullName }
  return { owner: fullName.slice(0, slash), name: fullName.slice(slash + 1) }
}

/** A transient tracked app used to seed the install-options dialog. */
function appFromRepo(repo: GitHubRepoSummaryWire, id: number): TrackedApp {
  const { owner, name } = splitFullName(repo.full_name)
  return new TrackedApp({
    id,
    repoOwner: owner,
    repoName: name,
    displayName: name,
    createdAt: new Date()
  })
}

/** Formats an ISO instant as a local date, falling back to the raw value. */
function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

type GithubRepoRowProps = {
  repo: GitHubRepoSummaryWire
  /** True while this row's add-only request is in flight. */
  adding: boolean
  onInstall: () => void
  onAddToList: () => void
}

function GithubRepoRow({ repo, adding, onInstall, onAddToList }: GithubRepoRowProps): JSX.Element {
  return (
    <li className="bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-semibold text-text-strong">{repo.full_name}</span>
        {repo.license?.spdx_id ? <Badge tone="neutral">{repo.license.spdx_id}</Badge> : null}
      </div>
      {repo.description ? <p className="mt-0.5 text-xs text-muted">{repo.description}</p> : null}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>★ {repo.stargazers_count.toLocaleString()}</span>
        {repo.language ? <span>{repo.language}</span> : null}
        <span>Updated {formatDate(repo.updated_at)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary"
          size="small"
          aria-label={`Add and install ${repo.full_name}`}
          onClick={onInstall}
        >
          Add &amp; install
        </Button>
        <Button
          variant="ghost"
          size="small"
          aria-label={`Add ${repo.full_name} to list`}
          disabled={adding}
          onClick={onAddToList}
        >
          {adding ? 'Adding…' : 'Add to list'}
        </Button>
      </div>
    </li>
  )
}

export type GithubRepoResultsProps = {
  /** Opens the settings sheet so the user can add a GitHub token. */
  onOpenSettings?: () => void
}

/**
 * GitHub repository search results with debounced querying and "load more"
 * pagination up to GitHub's 1000-result cap.
 *
 * "Add & install" tracks the repository (via `addApp`) and then installs it
 * (via `installApp`) after the user confirms the destination in the shared
 * install-options dialog.
 */
export function GithubRepoResults({ onOpenSettings }: GithubRepoResultsProps): JSX.Element {
  const { sort, perPage } = useGithubSearchDefaults()
  const { addApp, installApp } = useActions()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pendingRepo, setPendingRepo] = useState<GitHubRepoSummaryWire | null>(null)
  const [installContext, setInstallContext] = useState<{
    repo: GitHubRepoSummaryWire
    id: number
    options: InstallOptions
  } | null>(null)

  const search = useGithubSearch({ query, sort, perPage, page })
  const { data, debouncedQuery } = search
  const active = debouncedQuery.length >= GITHUB_SEARCH_MIN_QUERY_LENGTH

  // Derive the accumulated pages from the query cache rather than copying them
  // into component state: each "load more" adds a page query, and `data` (the
  // newest resolved page) drives recomputation.
  const view = useMemo(() => {
    // Read the accumulated pages straight from the cache so a page that is
    // still loading (or has failed) does not discard the pages already shown.
    if (!active) return { items: [], total: 0, incomplete: false }
    const keyFor = (target: number): readonly unknown[] =>
      githubSearchQueryKey({ query: debouncedQuery, sort, perPage, page: target })
    const first = queryClient.getQueryData<GithubSearchPage>(keyFor(1))
    const collected: GitHubRepoSummaryWire[] = []
    // `data` is the newest resolved page; reading it here both guards a stale
    // page number and makes this memo recompute when a page resolves, since the
    // direct `getQueryData` reads below are not reactive.
    const lastPage = Math.max(page, data?.page ?? 1)
    for (let current = 1; current <= lastPage; current++) {
      const cached = queryClient.getQueryData<GithubSearchPage>(keyFor(current))
      if (cached == null) break
      collected.push(...cached.result.items)
    }
    return {
      items: collected,
      total: first?.result.total_count ?? 0,
      incomplete: first?.result.incomplete_results === true
    }
  }, [active, queryClient, debouncedQuery, sort, perPage, page, data])

  const { items, total, incomplete } = view
  const canLoadMore =
    active && items.length > 0 && items.length < Math.min(total, GITHUB_SEARCH_RESULT_CAP)

  const rateLimit = useMemo(
    () => (search.isError ? parseGithubRateLimit(search.error) : null),
    [search.isError, search.error]
  )

  function handleQueryChange(value: string): void {
    setQuery(value)
    setPage(1)
  }

  async function handleConfirmInstall(options: InstallOptions): Promise<void> {
    const repo = pendingRepo
    if (repo == null) return
    const { owner, name } = splitFullName(repo.full_name)
    try {
      // Track first, then let the user pick a release asset before installing.
      const id = await addApp.mutateAsync({ repoOwner: owner, repoName: name, displayName: name })
      setInstallContext({ repo, id, options })
    } catch {
      // The mutations' onError already raised a persistent notification.
    } finally {
      setPendingRepo(null)
    }
  }

  async function handleAssetConfirm(assetName: string | null): Promise<void> {
    const context = installContext
    if (context == null) return
    const { repo, id, options } = context
    try {
      await installApp.mutateAsync({
        app: appFromRepo(repo, id),
        options: { ...options, assetName }
      })
    } catch {
      // The mutation's onError already raised a persistent notification.
    } finally {
      setInstallContext(null)
    }
  }

  /** Tracks the repository without installing anything. */
  async function handleAddToList(repo: GitHubRepoSummaryWire): Promise<void> {
    const { owner, name } = splitFullName(repo.full_name)
    try {
      await addApp.mutateAsync({ repoOwner: owner, repoName: name, displayName: name })
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  const busy = addApp.isPending || installApp.isPending
  const loadingFirstPage = active && search.isPending && items.length === 0

  // `keepPreviousData` keeps the last page visible while the next query loads;
  // without an indicator that reads as stale results, so surface one and dim
  // the rows that no longer match the pending query.
  const searching = active && (search.isDebouncing || search.isFetching)
  const showInlineSearching = searching && !loadingFirstPage
  const showLoadMoreError = active && search.isError && rateLimit == null && items.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <SearchField
          value={query}
          onChange={handleQueryChange}
          placeholder="Search GitHub repositories…"
          label="Search GitHub repositories"
        />
        {showInlineSearching ? (
          <span
            role="status"
            aria-live="polite"
            className="flex items-center gap-1.5 text-xs text-muted"
          >
            <Spinner className="size-3" />
            <span>Searching…</span>
          </span>
        ) : null}
        {incomplete ? <Badge tone="warning">Partial results</Badge> : null}
      </div>

      {active && items.length > 0 ? (
        <p className="pb-2 text-2xs text-muted">
          Showing {items.length.toLocaleString()} of{' '}
          {Math.min(total, GITHUB_SEARCH_RESULT_CAP).toLocaleString()}
          {total > GITHUB_SEARCH_RESULT_CAP ? ' (GitHub caps search results at 1,000)' : ''}
        </p>
      ) : null}

      {rateLimit ? (
        <div
          role="alert"
          className="mb-3 rounded-field border border-star/40 bg-star/10 px-3 py-2 text-xs text-star"
        >
          <p>
            GitHub search rate limit reached.
            {rateLimit.resetAt != null ? (
              <>
                {' '}
                Resets at{' '}
                <time dateTime={rateLimit.resetAt.toISOString()}>
                  {rateLimit.resetAt.toLocaleTimeString()}
                </time>
                .
              </>
            ) : null}
          </p>
          <Button
            variant="default"
            size="small"
            className="mt-2"
            onClick={() => onOpenSettings?.()}
          >
            Add a GitHub token
          </Button>
        </div>
      ) : null}

      {!active ? (
        <EmptyState
          title="Search GitHub repositories"
          description={`Type at least ${GITHUB_SEARCH_MIN_QUERY_LENGTH} characters to search.`}
        />
      ) : loadingFirstPage ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-16 text-sm text-muted"
        >
          <Spinner />
          <span>Searching GitHub…</span>
        </div>
      ) : search.isError && rateLimit == null && items.length === 0 ? (
        <EmptyState
          title="Could not search GitHub"
          description={search.error?.message ?? 'An unexpected error occurred.'}
          action={
            <Button variant="default" size="small" onClick={() => void search.refetch()}>
              Retry
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title={`No repositories found for “${debouncedQuery}”`} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ul
            aria-label="GitHub repository results"
            className={cn(
              'min-h-0 flex-1 divide-y divide-border overflow-y-auto transition-opacity',
              searching && 'opacity-60'
            )}
          >
            {items.map((repo) => {
              const { owner, name } = splitFullName(repo.full_name)
              const adding =
                addApp.isPending &&
                addApp.variables?.repoOwner === owner &&
                addApp.variables?.repoName === name
              return (
                <GithubRepoRow
                  key={repo.full_name}
                  repo={repo}
                  adding={adding}
                  onInstall={() => setPendingRepo(repo)}
                  onAddToList={() => void handleAddToList(repo)}
                />
              )
            })}
          </ul>
          {showLoadMoreError ? (
            <div
              role="alert"
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-field border border-red/40 bg-red/10 px-3 py-2 text-xs text-red"
            >
              <span>{search.error?.message ?? 'Could not load more results.'}</span>
              <Button variant="default" size="small" onClick={() => void search.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
          {canLoadMore ? (
            <div className="pt-3">
              <Button
                variant="default"
                size="small"
                disabled={search.isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                {search.isFetching ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {pendingRepo != null ? (
        <Suspense fallback={<DialogFallback />}>
          <InstallOptionsDialog
            app={appFromRepo(pendingRepo, -1)}
            busy={busy}
            onCancel={() => setPendingRepo(null)}
            onConfirm={(options) => void handleConfirmInstall(options)}
          />
        </Suspense>
      ) : null}

      {installContext != null ? (
        <GithubAssetDialog
          repoOwner={splitFullName(installContext.repo.full_name).owner}
          repoName={splitFullName(installContext.repo.full_name).name}
          displayName={installContext.repo.full_name}
          busy={installApp.isPending}
          onCancel={() => setInstallContext(null)}
          onConfirm={(assetName) => void handleAssetConfirm(assetName)}
        />
      ) : null}
    </div>
  )
}
