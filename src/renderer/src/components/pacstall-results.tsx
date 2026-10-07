// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, useMemo, useState, type JSX } from 'react'
import { filterPacstallIndex } from '@core/index'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { useActions } from '@renderer/src/hooks/use-actions'
import {
  usePacstallActions,
  usePacstallIndex,
  usePacstallPackageInfo,
  usePacstallStatus
} from '@renderer/src/hooks/use-pacstall'
import { useNotifications } from './notifications'
import { SearchField } from './search-field'
import { Badge, Button, EmptyState, Spinner } from './ui'

/**
 * The pacstall install guide. Must be an allowlisted host (`github.com`),
 * because `openExternal` refuses anything else.
 */
const PACSTALL_INSTALL_DOCS_URL = 'https://github.com/pacstall/pacstall'

/** The lazily-fetched `.SRCINFO` metadata shown when a row is expanded. */
function PacstallResultDetails({ name }: { name: string }): JSX.Element {
  const info = usePacstallPackageInfo(name)

  if (info.isPending) {
    return (
      <div role="status" className="mt-1 flex items-center gap-2 text-xs text-muted">
        <Spinner />
        <span>Loading {name}…</span>
      </div>
    )
  }

  if (info.isError) {
    return (
      <p className="mt-1 text-xs text-red">
        Could not load package info: {info.error?.message ?? 'unknown error'}
      </p>
    )
  }

  const pkg = info.data
  if (pkg == null) return <></>

  return (
    <dl className="mt-1 space-y-0.5 text-xs text-muted">
      {pkg.pkgdesc ? (
        <div>
          <dt className="inline font-medium text-secondary">Description: </dt>
          <dd className="inline">{pkg.pkgdesc}</dd>
        </div>
      ) : null}
      {pkg.maintainer ? (
        <div>
          <dt className="inline font-medium text-secondary">Maintainer: </dt>
          <dd className="inline">{pkg.maintainer}</dd>
        </div>
      ) : null}
      {pkg.depends.length > 0 ? (
        <div>
          <dt className="inline font-medium text-secondary">Depends: </dt>
          <dd className="inline">{pkg.depends.join(', ')}</dd>
        </div>
      ) : null}
      {pkg.optdepends.length > 0 ? (
        <div>
          <dt className="inline font-medium text-secondary">Optional: </dt>
          <dd className="inline">{pkg.optdepends.join(', ')}</dd>
        </div>
      ) : null}
    </dl>
  )
}

type PacstallResultRowProps = {
  name: string
  expanded: boolean
  installing: boolean
  /** True while this row's add-only request is in flight. */
  adding: boolean
  /** False when pacstall is missing (or resolved to an unexpected path). */
  canInstall: boolean
  /** Points the disabled Install button at the banner that explains why. */
  installHintId?: string
  onToggle: () => void
  onInstall: () => void
  onAddToList: () => void
}

function PacstallResultRow({
  name,
  expanded,
  installing,
  adding,
  canInstall,
  installHintId,
  onToggle,
  onInstall,
  onAddToList
}: PacstallResultRowProps): JSX.Element {
  const detailsId = useId()
  return (
    <li className="bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          onClick={onToggle}
          className="truncate text-sm font-semibold text-text-strong hover:underline"
        >
          {name}
        </button>
        <Button
          variant="primary"
          size="small"
          aria-label={`Install ${name}`}
          aria-describedby={installHintId}
          disabled={installing || !canInstall}
          onClick={onInstall}
        >
          {installing ? 'Installing…' : 'Install'}
        </Button>
        <Button
          variant="ghost"
          size="small"
          aria-label={`Add ${name} to list`}
          disabled={adding}
          onClick={onAddToList}
        >
          {adding ? 'Adding…' : 'Add to list'}
        </Button>
      </div>
      {expanded ? (
        <div id={detailsId} role="group" aria-label={`${name} package details`}>
          <PacstallResultDetails name={name} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * The pacstall-package half of the Discover view.
 *
 * Filtering is instant and client-side over the cached registry index (via the
 * core `filterPacstallIndex`); expanding a row lazily fetches that package's
 * `.SRCINFO`. When pacstall is not detected a banner offers the install guide
 * and a "Detect again" re-check.
 */
export function PacstallResults(): JSX.Element {
  const status = usePacstallStatus()
  const index = usePacstallIndex()
  const { addPacstall, installPacstall } = usePacstallActions()
  const { openExternal } = useActions()
  const { notify } = useNotifications()

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const matches = useMemo(
    () => filterPacstallIndex(index.data?.names ?? [], query),
    [index.data, query]
  )

  async function handleInstall(name: string): Promise<void> {
    try {
      const id = await addPacstall.mutateAsync({ name, displayName: name })
      const pkg = new TrackedPacstallPackage({
        id,
        name,
        displayName: name,
        createdAt: new Date(),
        registryRepo: ''
      })
      await installPacstall.mutateAsync(pkg)
      notify({ tone: 'success', message: `Installing ${name}…` })
    } catch {
      // The mutations' onError already raised a persistent notification.
    }
  }

  /** Tracks the package without installing it; always available. */
  async function handleAddToList(name: string): Promise<void> {
    try {
      await addPacstall.mutateAsync({ name, displayName: name })
      notify({ tone: 'success', message: `Added ${name} to your list.` })
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  const pathUnexpected = status.data?.pathUnexpected === true
  const showBanner = status.data != null && (!status.data.installed || pathUnexpected)
  const canInstall = status.data != null && !showBanner
  const bannerId = useId()
  const trimmedQuery = query.trim()

  return (
    <div className="flex h-full flex-col">
      {showBanner ? (
        <div
          id={bannerId}
          role="status"
          className="mb-3 rounded-field border border-star/40 bg-star/10 px-3 py-2 text-xs text-star"
        >
          {pathUnexpected ? (
            <p>
              pacstall resolved to an unexpected path ({status.data?.path ?? 'unknown'}). AutoNex
              only installs through <code>/usr/bin/pacstall</code>.
            </p>
          ) : (
            <p>pacstall is not installed on this system.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="default"
              size="small"
              onClick={() => void openExternal.mutateAsync(PACSTALL_INSTALL_DOCS_URL)}
            >
              How to install pacstall
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={status.isFetching}
              onClick={() => void status.refetch()}
            >
              {status.isFetching ? 'Detecting…' : 'Detect again'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Filter pacstall packages…"
          label="Filter pacstall packages"
        />
        {index.data?.fromCache ? <Badge tone="neutral">Cached index</Badge> : null}
      </div>

      {index.isPending ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-16 text-sm text-muted"
        >
          <Spinner />
          <span>Loading the pacstall index…</span>
        </div>
      ) : index.isError ? (
        <EmptyState
          title="Could not load the pacstall index"
          description={index.error?.message ?? 'An unexpected error occurred.'}
          action={
            <Button variant="default" size="small" onClick={() => void index.refetch()}>
              Retry
            </Button>
          }
        />
      ) : trimmedQuery.length === 0 ? (
        <EmptyState
          title="Filter pacstall packages"
          description="Type a package name to filter the registry index."
        />
      ) : matches.length === 0 ? (
        <EmptyState title={`No pacstall packages match “${trimmedQuery}”`} />
      ) : (
        <ul
          aria-label="pacstall package results"
          className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
        >
          {matches.map((name) => (
            <PacstallResultRow
              key={name}
              name={name}
              expanded={expanded === name}
              installing={installPacstall.isPending && installPacstall.variables?.name === name}
              adding={addPacstall.isPending && addPacstall.variables?.name === name}
              canInstall={canInstall}
              installHintId={showBanner ? bannerId : undefined}
              onToggle={() => setExpanded((current) => (current === name ? null : name))}
              onInstall={() => void handleInstall(name)}
              onAddToList={() => void handleAddToList(name)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
