// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { JSX } from 'react'
import { useDebouncedValue } from '@renderer/src/hooks/use-github-search'
import { formatDate } from '@renderer/src/lib/format-date'
import { Button, Spinner } from './ui'

/** How long the preview waits after the last edit before querying GitHub. */
export const FILTER_PREVIEW_DEBOUNCE_MS = 400

export type FilterPreviewProps = {
  repoOwner: string
  repoName: string
  includePrerelease?: boolean
  assetFilterPattern?: string
  tagPrefix?: string
  architectures?: string[]
}

/**
 * Live preview of what the current filters match on the latest release.
 *
 * The filters are debounced ({@link FILTER_PREVIEW_DEBOUNCE_MS}) so typing a
 * pattern does not fire a request per keystroke. The preview reports the
 * resolved tag, its publish date, every asset name that survives the filters
 * (installable or not) and how many matched against the release's total, so the
 * user can tune a wildcard before saving.
 */
export function FilterPreview({
  repoOwner,
  repoName,
  includePrerelease,
  assetFilterPattern,
  tagPrefix,
  architectures
}: FilterPreviewProps): JSX.Element | null {
  const pattern = useDebouncedValue(assetFilterPattern ?? '', FILTER_PREVIEW_DEBOUNCE_MS)
  const tag = useDebouncedValue(tagPrefix ?? '', FILTER_PREVIEW_DEBOUNCE_MS)
  const arch = useDebouncedValue((architectures ?? []).join(','), FILTER_PREVIEW_DEBOUNCE_MS)
  const enabled = repoOwner.length > 0 && repoName.length > 0

  const query = useQuery({
    queryKey: [
      'releasePreview',
      repoOwner,
      repoName,
      includePrerelease === true,
      pattern,
      tag,
      arch
    ],
    queryFn: () =>
      window.autonex.getGithubReleaseAssets({
        repoOwner,
        repoName,
        ...(includePrerelease != null ? { includePrerelease } : {}),
        ...(pattern.length > 0 ? { assetFilterPattern: pattern } : {}),
        ...(tag.length > 0 ? { tagPrefix: tag } : {}),
        ...(arch.length > 0 ? { architectures: arch.split(',') } : {})
      }),
    enabled,
    placeholderData: keepPreviousData
  })

  if (!enabled) return null

  const data = query.data
  const matched = data?.matchedNames ?? data?.assets.map((asset) => asset.name) ?? []
  const total = data?.totalAssets ?? data?.assets.length ?? 0

  return (
    <section
      aria-label="Release preview"
      className="rounded-field border border-border bg-field px-3 py-2"
    >
      <h4 className="text-xs font-medium text-secondary">Release preview</h4>
      {query.isPending ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-1 flex items-center gap-2 text-xs text-muted"
        >
          <Spinner />
          <span>Checking the latest release…</span>
        </div>
      ) : query.isError ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-red">
          <span>{query.error?.message ?? 'Could not check the release.'}</span>
          <Button variant="ghost" size="small" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : data == null || data.tagName == null ? (
        <p className="mt-1 text-xs text-muted">No matching release found.</p>
      ) : (
        <div className="mt-1 space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-text-strong">{data.tagName}</span>
            <span className="text-muted">Released: {formatDate(data.publishedAt)}</span>
            <span className="text-muted">
              {matched.length} of {total} asset{total === 1 ? '' : 's'} match
            </span>
          </div>
          {matched.length > 0 ? (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {matched.map((name) => (
                <li key={name} className="truncate text-muted">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No asset matches the current filters.</p>
          )}
        </div>
      )}
    </section>
  )
}
